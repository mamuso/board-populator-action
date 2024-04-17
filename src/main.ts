import PopulateBoards from './populate-boards'
import * as core from '@actions/core'
import type {Config} from './types'

const populateConfig: Config = {
  organization: core.getBooleanInput('organization'),
  cards_path: core.getInput('cards_path'),
  boards: core.getInput('boards'),
  delimiter: core.getInput('delimiter'),
  use_delimiter: core.getBooleanInput('use_delimiter'),
  development_mode: core.getBooleanInput('development_mode'),
  column_name: core.getInput('column_name'),
  token: core.getInput('token')
}

const populate = new PopulateBoards(populateConfig)
populate.run()
