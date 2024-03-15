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
      // eslint-disable-next-line no-console
      console.log(`Running populate-boards action ${this.config.token}`)
      const boardsData: string = JSON.stringify(yaml.load(fs.readFileSync(`${this.config.boards}`, 'utf8')))
      const boards: Board[] = JSON.parse(boardsData).boards

      let auth

      // We don't need to authenticate if we are in development mode
      if (!this.config.development_mode) {
        if (this.config.token === null) {
          // TODO: Implement app authentication
        } else {
          auth = createTokenAuth(this.config.token ?? '')
        }
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
        const {projectId, statusId, statusOptions, boardItems} = await this.getProjectMetadata(graphqlWithAuth, board)
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

        // Create cards and set status
        for (const content of board.content) {
          // Load card content from file
          const cardPath = `${this.config.cards_path}/${content}.yml`
          const cardContent = JSON.stringify(yaml.load(fs.readFileSync(cardPath, 'utf8')))
          const cards: Card[] = JSON.parse(cardContent).cards

          for (const c of cards) {
            // eslint-disable-next-line no-console
            console.log(c.title)

            // We don't need to add cards if we are in development mode
            if (!this.config.development_mode) {
              // Add card and set status
              const cardId: string = await this.addCard(graphqlWithAuth, projectId, c)
              await this.updateCardStatus(
                graphqlWithAuth,
                projectId,
                cardId,
                statusId,
                this.optionIdByName(statusOptions, c.column ?? '')
              )
            }
          }
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error)
    }
  }

  async getProjectMetadata(
    graphqlWithAuth: typeof graphql,
    board: Board
  ): Promise<{
    projectId: string
    statusId: string
    statusOptions: [{id: string; name: string}]
    boardItems: [{node: {id: string}}]
  }> {
    const projectQuery: GraphQlQueryResponseData = await graphqlWithAuth(`
      query {
        organization(login:"${board.owner}"){
          projectV2(number: ${board.board_id}) {
            id
            field(name:"Status") {
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
      statusId: projectQuery.organization.projectV2.field.id,
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
    statusId: string,
    valueId: string | undefined
  ): Promise<void> {
    if (valueId) {
      await graphqlWithAuth(`
        mutation {
          updateProjectV2ItemFieldValue(input:{
            projectId: "${projectId}"
            itemId: "${cardId}"
            fieldId: "${statusId}"
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
