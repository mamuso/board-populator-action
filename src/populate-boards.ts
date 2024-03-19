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
        // Ensuring board default values are set
        const board: Board = {
          ...this.boardDefault,
          ...b
        }

        // Get the project metadata
        const projectId = await this.getProjectId(graphqlWithAuth, board)
        // eslint-disable-next-line no-console
        console.log(`\n# projectId ${projectId}`)
        // eslint-disable-next-line no-console
        console.log(`---------------------------------------------------------------`)
        let {columnId, columnOptions} = await this.getColumnOptions(graphqlWithAuth, projectId)
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
          await this.emptyProject(graphqlWithAuth, projectId)

          // Update the board metadata
          await this.updateBoardMeta(graphqlWithAuth, projectId, board)
        }

        const removethisline = [columnId, columnOptions]
        removethisline

        // Create cards and set status
        let columns: string[] = []
        const cardContents: Card[] = []
        for (const content of board.content) {
          // Columns
          const cardsPath = `${this.config.cards_path}/${content}/`
          const folderNames = fs.readdirSync(cardsPath)
          columns = columns.concat(folderNames)

          // Parse cards
          for (const folderName of folderNames) {
            const files = fs.readdirSync(`${cardsPath}/${folderName}`)
            for (const file of files) {
              if (file.endsWith('.md')) {
                const cardPath = `${cardsPath}/${folderName}/${file}`
                const cardContent = fs.readFileSync(cardPath, 'utf8')
                const card: Card = {
                  title: file.replace('.md', ''),
                  body: cardContent,
                  column: folderName
                }
                cardContents.push(card)
              }
            }
          }
        }

        // Sort columns
        columns = await this.sortColumns(columns)

        // Create columns
        if (!this.config.development_mode) {
          await this.createColumn(graphqlWithAuth, projectId, columnId, columns)
          // refresh column options
          const refreshColumn = await this.getColumnOptions(graphqlWithAuth, projectId)
          columnId = refreshColumn.columnId
          columnOptions = refreshColumn.columnOptions
        }

        // Insert cards
        for (const card of cardContents) {
          // eslint-disable-next-line no-console
          console.log(this.sanitizeName(card.title))
        }
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
        //       this.optionIdByName(columnOptions, c.column ?? '')
        //     )
        //   }
        // }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error)
    }
  }

  async getProjectId(graphqlWithAuth: typeof graphql, board: Board): Promise<string> {
    const projectQuery: GraphQlQueryResponseData = await graphqlWithAuth(`
      query {
        organization(login:"${board.owner}"){
          projectV2(number: ${board.board_id}) {
            id
          }
        }
      }
    `)

    return projectQuery.organization.projectV2.id
  }

  async getColumnOptions(
    graphqlWithAuth: typeof graphql,
    projectId: string
  ): Promise<{
    columnId: string
    columnOptions: [{id: string; name: string}]
  }> {
    try {
      const projectQuery: GraphQlQueryResponseData = await graphqlWithAuth(`
      query {
        node(id: "${projectId}") {
          ... on ProjectV2 {
            field(name: "${this.config.column_name}") {
              ... on ProjectV2SingleSelectField {
                id
                name
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }
    `)

      return {
        columnId: projectQuery.node.field.id,
        columnOptions: projectQuery.node.field.options
      }
    } catch (error) {
      return {
        columnId: '',
        columnOptions: [{id: '', name: ''}]
      }
    }
  }

  async getBoardItems(graphqlWithAuth: typeof graphql, projectId: string): Promise<[{node: {id: string}}] | []> {
    try {
      const projectItemsQuery: GraphQlQueryResponseData = await graphqlWithAuth(`
      query {
        node(id: "${projectId}") {
          ... on ProjectV2 {
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

      return projectItemsQuery.node.items.edges
    } catch (error) {
      return []
    }
  }

  sanitizeName(name: string): string {
    if (this.config.use_delimiter && this.config.delimiter) {
      name = name
        .split(this.config.delimiter ?? '')
        .slice(1)
        .join(this.config.delimiter ?? '')
    }

    return name
  }

  async sortColumns(columns: string[]): Promise<string[]> {
    // Sort columns
    columns.sort()

    // Sanitize the column names if we use a delimiter
    if (this.config.use_delimiter && this.config.delimiter) {
      columns = columns.map(column => (column = this.sanitizeName(column)))
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
    // Delete column
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
    // Create column
    const createColumnQuery: string[] = []
    for (const column of columns) {
      createColumnQuery.push(`{name: "${column}", description: "", color: GRAY}`)
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

    return fieldQuery.createProjectV2Field.projectV2Field.id
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

  async emptyProject(graphqlWithAuth: typeof graphql, projectId: string): Promise<void> {
    let deleteQuery = ''

    let isEmpty = false
    while (!isEmpty) {
      const boardItems = await this.getBoardItems(graphqlWithAuth, projectId)
      if (boardItems.length === 0) {
        isEmpty = true
        break
      }

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
