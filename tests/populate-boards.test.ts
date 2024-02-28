import * as process from 'process'
import PopulateBoard from '../src/populate-boards'
import type {config} from '../src/types'

// Constants
const token: string | undefined = process.env.GITHUB_TOKEN

describe('PopulateBoard test suite', () => {
  beforeEach(async () => {})

  afterAll(async () => {
    jest.restoreAllMocks()
  })

  // it('shoudl fail if no token is provided', async () => {
  //   const config: config = {}
  //   expect(() => {
  //     const populateBoardAction = new PopulateBoard(config)
  //     populateBoardAction.run()
  //   }).toThrow('Input required and not supplied: token')
  // })
})
