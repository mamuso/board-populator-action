import fs from 'fs'
import yaml from 'js-yaml'
import {graphql} from '@octokit/graphql'
import {createTokenAuth} from '@octokit/auth-token'
import type {GraphQlQueryResponseData} from '@octokit/graphql'
// import {createAppAuth} from '@octokit/auth-app'

import DefaultConfig from './config'
import type {Config, Board, Card} from './types'

export default class PopulateBoard {
  config: Config
  boardDefault = {
    description: ''
  }

  constructor(populateConfig: Config) {
    this.config = new DefaultConfig().config
    Object.assign(this.config, populateConfig)
  }

  async run(): Promise<void> {
    try {
      const boardsData: string = JSON.stringify(yaml.load(fs.readFileSync(`${this.config.boards}`, 'utf8')))
      const boards: Board[] = JSON.parse(boardsData).boards

      // Even if we are in development mode, we will authenticate
      let auth
      if (this.config.token === null) {
        // TODO: Implement app authentication
      } else {
        auth = createTokenAuth(this.config.token ?? '')
      }
      const graphqlWithAuth = graphql.defaults({
        request: {
          hook: auth?.hook
        }
      })

      for (const b of boards) {
        // Making sure that some board default values are set
        const board: Board = {
          ...this.boardDefault,
          ...b
        }

        // Get the project metadata
        const {projectId, columnId, statusOptions, boardItems} = await this.getProjectMetadata(graphqlWithAuth, board)
        if (!projectId) {
          throw new Error('Project ID not found')
        }

        // eslint-disable-next-line no-console
        console.log(`\n# Populating ${board.name}`)
        // eslint-disable-next-line no-console
        console.log(`---------------------------------------------------------------`)

        // We don't need to empty the project if we are in development mode
        if (!this.config.development_mode) {
          // Empty the project
          await this.emptyProject(graphqlWithAuth, projectId, boardItems)

          // Update the board metadata
          await this.updateBoardMeta(graphqlWithAuth, projectId, board)
        }

        const removethisline = [columnId, statusOptions]
        removethisline

        // Create cards and set status
        let columns: string[] = []
        for (const content of board.content) {
          // Columns
          const cardsPath = `${this.config.cards_path}/${content}/`
          const folderNames = fs.readdirSync(cardsPath)
          columns = columns.concat(folderNames)

          // const cardContent = JSON.stringify(yaml.load(fs.readFileSync(cardPath, 'utf8')))
          // const cards: Card[] = JSON.parse(cardContent).cards

          // for (const c of cards) {
          //   // eslint-disable-next-line no-console
          //   console.log(c.title)

          //   // We don't need to add cards if we are in development mode
          //   if (!this.config.development_mode) {
          //     // Add card and set status
          //     const cardId: string = await this.addCard(graphqlWithAuth, projectId, c)
          //     await this.updateCardStatus(
          //       graphqlWithAuth,
          //       projectId,
          //       cardId,
          //       columnId,
          //       this.optionIdByName(statusOptions, c.column ?? '')
          //     )
          //   }
          // }
        }

        // Sort columns
        columns = await this.sortColumns(columns)

        // Create columns
        if (!this.config.development_mode) {
          await this.createColumn(graphqlWithAuth, projectId, columnId, columns)
        }

        // eslint-disable-next-line no-console
        console.log(columns)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error)
    }
  }

  async sortColumns(columns: string[]): Promise<string[]> {
    // Sort columns
    columns.sort()

    // Sanitize the column names if we use a delimiter
    if (this.config.use_delimiter && this.config.delimiter) {
      columns = columns.map(column =>
        column
          .split(this.config.delimiter ?? '')
          .slice(1)
          .join(this.config.delimiter ?? '')
      )
    }

    // Compact the array
    columns = columns.filter((value, index, self) => {
      return self.indexOf(value) === index
    })

    return columns
  }

  async createColumn(
    graphqlWithAuth: typeof graphql,
    projectId: string,
    columnId: string,
    columns: string[]
  ): Promise<string> {
    // Delete columns
    if (columnId) {
      await graphqlWithAuth(`
        mutation {
          deleteProjectV2Field(input: {
            fieldId: "${columnId}"
          }) {
            clientMutationId
          }
        }
      `)
    }
    // Create columns
    const createColumnQuery: string[] = []
    for (const column of columns) {
      createColumnQuery.push(`{name: "${column}", color: GRAY}`)
    }
    const fieldQuery: GraphQlQueryResponseData = await graphqlWithAuth(`
      mutation {
        createProjectV2Field(
          input: {
            projectId: "${projectId}", 
            dataType: SINGLE_SELECT,
            name: "${this.config.column_name}", 
            singleSelectOptions: [${createColumnQuery.join(', ')}]
          }
        ){
          projectV2Field {
            ... on ProjectV2Field {
              id
            }
          }
        }
      }
    `)

    // eslint-disable-next-line no-console
    console.log(fieldQuery)
    return fieldQuery.createProjectV2Field.projectV2Field.id
  }

  async getProjectMetadata(
    graphqlWithAuth: typeof graphql,
    board: Board
  ): Promise<{
    projectId: string
    columnId: string
    statusOptions: [{id: string; name: string}]
    boardItems: [{node: {id: string}}]
  }> {
    const projectQuery: GraphQlQueryResponseData = await graphqlWithAuth(`
      query {
        organization(login:"${board.owner}"){
          projectV2(number: ${board.board_id}) {
            id
            field(name:"${this.config.column_name}") {
              ... on ProjectV2SingleSelectField {
                id
                options {
                  id
                  name
                }
              }
            }
            items(first: 100) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      }
    `)

    return {
      projectId: projectQuery.organization.projectV2.id,
      columnId: projectQuery.organization.projectV2.field.id,
      statusOptions: projectQuery.organization.projectV2.field.options,
      boardItems: projectQuery.organization.projectV2.items.edges
    }
  }

  optionIdByName(options: [{id: string; name: string}], name: string): string | undefined {
    const option = options.find(o => o.name === name)
    if (option) {
      return option.id
    } else {
      return undefined
      // throw new Error(`Status option not found: ${name}`)
    }
  }

  async emptyProject(
    graphqlWithAuth: typeof graphql,
    projectId: string,
    boardItems: [{node: {id: string}}]
  ): Promise<void> {
    let deleteQuery = ''

    for (const i in boardItems) {
      deleteQuery += `
        deleteproject${i}: deleteProjectV2Item(input: {
          projectId: "${projectId}",
          itemId: "${boardItems[i].node.id}"
        }) {
          clientMutationId
        }
    `
    }
    if (deleteQuery !== '') {
      await graphqlWithAuth(`
        mutation {
          ${deleteQuery}
        }
      `)
    }
  }

  async updateBoardMeta(graphqlWithAuth: typeof graphql, projectId: string, board: Board): Promise<void> {
    await graphqlWithAuth(`
      mutation {
        updateProjectV2(
          input: {
            projectId: "${projectId}",
            title: "${board.name}",
            shortDescription: "${board.description}"
          }
        ) {
          projectV2 {
            id
          }
        }
      }
    `)
  }

  async addCard(graphqlWithAuth: typeof graphql, projectId: string, card: Card): Promise<string> {
    const cardQuery: GraphQlQueryResponseData = await graphqlWithAuth(`
      mutation {
        addProjectV2DraftIssue(
          input: {
            projectId: "${projectId}",
            title: "${card.title}",
            body: "${card.body}"
          }
        ) {
          projectItem {
            id
          }
        }
      }
    `)

    return cardQuery.addProjectV2DraftIssue.projectItem.id
  }

  async updateCardStatus(
    graphqlWithAuth: typeof graphql,
    projectId: string,
    cardId: string,
    columnId: string,
    valueId: string | undefined
  ): Promise<void> {
    if (valueId) {
      await graphqlWithAuth(`
        mutation {
          updateProjectV2ItemFieldValue(input:{
            projectId: "${projectId}"
            itemId: "${cardId}"
            fieldId: "${columnId}"
            value: {
              singleSelectOptionId: "${valueId}"
            }
          }) {
            projectV2Item {
              id
            }
          }
        }
      `)
    }
  }
}
