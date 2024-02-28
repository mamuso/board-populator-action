import PopulateBoards from './populate-boards'
import * as core from '@actions/core'
import type {Config} from './types'

const populateConfig: Config = {
  cards_path: core.getInput('cards_path'),
  boards: core.getInput('boards'),
  token: core.getInput('token')
}

const populate = new PopulateBoards(populateConfig)
populate.run()
