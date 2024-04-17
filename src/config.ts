import type {Config} from './types'

// DefaultConfig is a class that sets the default configuration for the action
export default class DefaultConfig {
  config: Config
  constructor() {
    this.config = {
      organization: true,
      cards_path: 'cards',
      boards: 'boards.yml',
      delimiter: '-',
      use_delimiter: false,
      development_mode: false,
      column_name: 'Column',
      token: null
    }
  }
}
