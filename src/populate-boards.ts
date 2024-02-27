import fs from 'fs'
import yaml from 'js-yaml'
import {graphql} from '@octokit/graphql'
import {createTokenAuth} from '@octokit/auth-token'
// import {createAppAuth} from '@octokit/auth-app'

import DefaultConfig from './config'
import type {config, board} from './types'

export default class PopulateBoard {
  config: config

  constructor(populateConfig: config) {
    // Merge the default configuration with the user's configuration
    this.config = new DefaultConfig().config
    Object.assign(this.config, populateConfig)
  }

  async run(): Promise<void> {
    const boardsData: string = JSON.stringify(yaml.load(fs.readFileSync(`${this.config.boards}`, 'utf8')))
    const boards: board[] = JSON.parse(boardsData).boards

    let auth
    if (this.config.token === null) {
      // TODO: Implement app authentication
      // assumes app authentication
      // auth = createAppAuth({
      //   appId: process.env.APP_ID,
      //   privateKey: process.env.PRIVATE_KEY,
      //   clientId: process.env.CLIENT_ID,
      //   clientSecret: process.env.CLIENT_SECRET,
      //   installationId: process.env.INSTALLATION_ID
      // })
    } else {
      auth = createTokenAuth(this.config.token ?? '')
    }

    const graphqlWithAuth = graphql.defaults({
      request: {
        hook: auth?.hook
      }
    })

    // iterate over the boards and update the content
    for (const b of boards) {
      // eslint-disable-next-line no-console
      console.log(`Updating board ${b.name}`)
      // eslint-disable-next-line no-console
      console.log(`Owner: ${b.owner}`)
      // eslint-disable-next-line no-console
      console.log(`Board ID: ${b.board_id}`)
      // eslint-disable-next-line no-console
      console.log(`Content: ${b.content}`)

      const boardId = await graphqlWithAuth(`
        query {
          organization(login:"${b.owner}"){
            projectV2(number: ${b.board_id}) {
              id
              title
            }
          }
        }
      `)

      // eslint-disable-next-line no-console
      console.log(boardId)

      // const board = graphqlWithAuth(`
      //   mutation {
      //     updateProjectV2(input: {projectId:"PVT_kwDNJr_OAHMVJw", title:"Updated title"}) {
      //     projectV2 {
      //       id
      //       title
      //     }
      //   }
      // `)
    }
  }
}
