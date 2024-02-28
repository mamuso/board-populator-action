import type {Config} from './types'

// DefaultConfig is a class that sets the default configuration for the action
export default class DefaultConfig {
  config: Config
  constructor() {
    this.config = {
      cards_path: 'cards',
      boards: 'boards.yml',
      token: null
    }
  }
}
