import fs from 'fs'
import yaml from 'js-yaml'
import {graphql} from '@octokit/graphql'
import {createTokenAuth} from '@octokit/auth-token'
import type {GraphQlQueryResponseData} from '@octokit/graphql'
// import {createAppAuth} from '@octokit/auth-app'

import DefaultConfig from './config'
import type {Config, Board} from './types'

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
        // Making sure that some board default values are set
        const board: Board = {
          ...this.boardDefault,
          ...b
        }

        const {projectId, statusId, statusOptions} = await this.getProjectMetadata(graphqlWithAuth, board)
        if (!projectId) {
          throw new Error('Project ID not found')
        }

        await this.emptyProject(graphqlWithAuth, projectId)

        await this.updateBoardMeta(graphqlWithAuth, projectId, board)

        const cardId: string = await this.addCard(graphqlWithAuth, projectId)
        await this.updateCardStatus(
          graphqlWithAuth,
          projectId,
          cardId,
          statusId,
          this.optionIdByName(statusOptions, 'Todo')
        )
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error)
    }
  }

  async getProjectMetadata(
    graphqlWithAuth: typeof graphql,
    board: Board
  ): Promise<{projectId: string; statusId: string; statusOptions: [{id: string; name: string}]}> {
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
          }
        }
      }
    `)

    return {
      projectId: projectQuery.organization.projectV2.id,
      statusId: projectQuery.organization.projectV2.field.id,
      statusOptions: projectQuery.organization.projectV2.field.options
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

  async emptyProject(graphqlWithAuth: typeof graphql, projectId: string): Promise<void> {
    const itemsQuery: GraphQlQueryResponseData = await graphqlWithAuth(`
      query {
        node(id: "${projectId}") {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
              }
            }
          }
        }
      }
    `)

    let deleteQuery = ''

    for (const item in itemsQuery.node.items.nodes) {
      // eslint-disable-next-line no-console
      console.log(item)
      deleteQuery += `
        deleteProjectV2Item(input: {
          projectId: "${projectId}",
          itemId: "${item}"
        }) {
          clientMutationId
        }
      `
    }

    await graphqlWithAuth(`
      mutation {
        ${deleteQuery}
      }
    `)
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

  async addCard(graphqlWithAuth: typeof graphql, projectId: string): Promise<string> {
    const cardQuery: GraphQlQueryResponseData = await graphqlWithAuth(`
      mutation {
        addProjectV2DraftIssue(
          input: {
            projectId: "${projectId}",
            title: "title",
            body: "body"
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
