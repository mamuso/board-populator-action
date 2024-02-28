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

        const projectId: string = await this.getProjectId(graphqlWithAuth, board)
        if (!projectId) {
          throw new Error('Project ID not found')
        }

        await this.updateBoardMeta(graphqlWithAuth, projectId, board)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error)
    }
  }

  async getProjectId(graphqlWithAuth: typeof graphql, board: Board): Promise<string> {
    const projectIdQuery: GraphQlQueryResponseData = await graphqlWithAuth(`
      query {
        organization(login:"${board.owner}"){
          projectV2(number: ${board.board_id}) {
            id
          }
        }
      }
    `)

    return projectIdQuery.organization.projectV2.id
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
}
