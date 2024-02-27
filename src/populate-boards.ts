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
    // eslint-disable-next-line no-console
    console.log('Running the populate-boards script')

    const boardsData: string = JSON.stringify(yaml.load(fs.readFileSync(`${this.config.boards}`, 'utf8')))
    const boards: board[] = JSON.parse(boardsData).boards

    // eslint-disable-next-line no-console
    console.log(`${boards[0].owner} ----`)

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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const graphqlWithAuth = graphql.defaults({
      request: {
        hook: auth?.hook
      }
    })
  }
}
