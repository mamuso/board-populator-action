import fs from 'fs'
import yaml from 'js-yaml'
import {graphql} from '@octokit/graphql'
import {createTokenAuth} from '@octokit/auth-token'
import type {GraphQlQueryResponseData} from '@octokit/graphql'
// import {createAppAuth} from '@octokit/auth-app'

import DefaultConfig from './config'
import type {Config, Board, Card, SelcetOption} from './types'

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
        // Ensuring board default values are set
        const board: Board = {
          ...this.boardDefault,
          ...b
        }

        // Get the project metadata
        const projectId = await this.getProjectId(graphqlWithAuth, board)
        let {columnId, columnOptions} = await this.getColumnOptions(graphqlWithAuth, projectId)
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
          await this.emptyProject(graphqlWithAuth, projectId)

          // Update the board metadata
          await this.updateBoardMeta(graphqlWithAuth, projectId, board)
        }

        // Create cards and set status
        let columns: string[] = []
        const cardContents: Card[] = []
        for (const content of board.content) {
          // Columns
          const cardsPath = `${this.config.cards_path}/${content}/`
          const folderNames = fs.readdirSync(cardsPath)
          columns = columns.concat(folderNames)

          // Parse cards
          for (const folderName of folderNames) {
            const files = fs.readdirSync(`${cardsPath}/${folderName}`)
            for (const file of files) {
              if (file.endsWith('.md')) {
                const cardPath = `${cardsPath}/${folderName}/${file}`
                const cardContent = fs.readFileSync(cardPath, 'utf8')
                const card: Card = {
                  title: file.replace('.md', ''),
                  body: cardContent,
                  column: folderName
                }
                cardContents.push(card)
              }
            }
          }
        }

        // Sort columns
        columns = await this.sortColumns(columns)

        // Create columns
        if (!this.config.development_mode) {
          await this.createColumn(graphqlWithAuth, projectId, columnId, columns)
          // refresh column options
          const refreshColumn = await this.getColumnOptions(graphqlWithAuth, projectId)
          columnId = refreshColumn.columnId
          columnOptions = refreshColumn.columnOptions
        }

        // Insert cards
        for (const card of cardContents) {
          // eslint-disable-next-line no-console
          console.log(this.sanitizeName(card.title))

          // We don't need to add cards if we are in development mode
          if (!this.config.development_mode) {
            // Add card and set status
            const cardId: string = await this.addCard(graphqlWithAuth, projectId, card)
            await this.updateCardStatus(
              graphqlWithAuth,
              projectId,
              cardId,
              columnId,
              this.optionIdByName(columnOptions, this.sanitizeName(card.column) ?? '')
            )
          }
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error)
    }
  }

  async getProjectId(graphqlWithAuth: typeof graphql, board: Board): Promise<string> {
    const query = `
    query GetProjectId($login: String!, $number: Int!) {
      organization(login: $login) {
        projectV2(number: $number) {
          id
        }
      }
    }
  `

    const variables = {
      login: board.owner,
      number: board.board_id
    }

    try {
      const projectQuery: GraphQlQueryResponseData = await graphqlWithAuth(query, variables)
      return projectQuery.organization.projectV2.id
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to get project ID: ${error}`)
      throw error
    }
  }

  async getColumnOptions(
    graphqlWithAuth: typeof graphql,
    projectId: string
  ): Promise<{
    columnId: string
    columnOptions: [{id: string; name: string}]
  }> {
    const query = `
    query GetColumnOptions($id: String!, $name: String!) {
      node(id: $id) {
        ... on ProjectV2 {
          field(name: $name) {
            ... on ProjectV2SingleSelectField {
              id
              name
              options {
                id
                name
              }
            }
          }
        }
      }
    }
  `

    const variables = {
      id: projectId,
      name: this.config.column_name
    }

    try {
      const projectQuery: GraphQlQueryResponseData = await graphqlWithAuth(query, variables)
      return {
        columnId: projectQuery.node.field.id,
        columnOptions: projectQuery.node.field.options
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to get column options: ${error}`)
      return {
        columnId: '',
        columnOptions: [{id: '', name: ''}]
      }
    }
  }

  async getBoardItems(graphqlWithAuth: typeof graphql, projectId: string): Promise<[{node: {id: string}}] | []> {
    const query = `
    query GetBoardItems($id: String!) {
      node(id: $id) {
        ... on ProjectV2 {
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
  `

    const variables = {
      id: projectId
    }

    try {
      const projectItemsQuery: GraphQlQueryResponseData = await graphqlWithAuth(query, variables)
      return projectItemsQuery.node.items.edges
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to get board items: ${error}`)
      return []
    }
  }

  sanitizeName(name: string | undefined): string {
    let sanitizedName = `${name}`
    if (this.config.use_delimiter && this.config.delimiter) {
      const processedName = sanitizedName.split(this.config.delimiter)
      if (processedName.length > 1) {
        sanitizedName = processedName.slice(1).join(this.config.delimiter)
      }
    }
    return sanitizedName
  }

  async sortColumns(columns: string[]): Promise<string[]> {
    // Sort columns
    columns.sort()

    // Sanitize the column names if we use a delimiter
    if (this.config.use_delimiter && this.config.delimiter) {
      columns = columns.map(column => this.sanitizeName(column))
    }

    // Compact the array
    columns = [...new Set(columns)]

    return columns
  }

  async createColumn(
    graphqlWithAuth: typeof graphql,
    projectId: string,
    columnId: string,
    columns: string[]
  ): Promise<string> {
    // Delete column
    if (columnId) {
      const deleteColumnQuery = `
      mutation DeleteColumn($fieldId: String!) {
        deleteProjectV2Field(input: { fieldId: $fieldId }) {
          clientMutationId
        }
      }
    `

      const deleteColumnVariables = {
        fieldId: columnId
      }

      try {
        await graphqlWithAuth(deleteColumnQuery, deleteColumnVariables)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`Failed to delete column: ${error}`)
        throw error
      }
    }

    // Create column
    const createColumnQuery = `
    mutation CreateColumn(
      $projectId: String!,
      $name: String!,
      $singleSelectOptions: [ProjectV2FieldSingleSelectOptionInput!]!
    ) {
      createProjectV2Field(
        input: {
          projectId: $projectId, 
          dataType: SINGLE_SELECT,
          name: $name, 
          singleSelectOptions: $singleSelectOptions
        }
      ) {
        projectV2Field {
          ... on ProjectV2Field {
            id
          }
        }
      }
    }
  `

    const createColumnVariables = {
      projectId,
      name: this.config.column_name,
      singleSelectOptions: columns.map(column => ({name: column, description: '', color: 'GRAY'}))
    }

    try {
      const fieldQuery: GraphQlQueryResponseData = await graphqlWithAuth(createColumnQuery, createColumnVariables)
      return fieldQuery.createProjectV2Field.projectV2Field.id
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to create column: ${error}`)
      throw error
    }
  }

  optionIdByName(options: SelcetOption[], name: string): string | undefined {
    return options.find(o => o.name === name)?.id
  }

  async emptyProject(graphqlWithAuth: typeof graphql, projectId: string): Promise<void> {
    let isEmpty = false
    let iterationCount = 0
    const maxIterations = 30 // Set a limit to avoid infinite loops

    while (!isEmpty && iterationCount < maxIterations) {
      iterationCount++

      const boardItems = await this.getBoardItems(graphqlWithAuth, projectId)

      if (boardItems.length === 0) {
        isEmpty = true
        break
      }

      const deleteQueries = boardItems.map(
        (item, index) => `
      deleteproject${index}: deleteProjectV2Item(input: {
        projectId: "${projectId}",
        itemId: "${item.node.id}"
      }) {
        clientMutationId
      }
    `
      )

      if (deleteQueries.length > 0) {
        const query = `
        mutation {
          ${deleteQueries.join('\n')}
        }
      `

        try {
          await graphqlWithAuth(query)
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error(`Failed to delete project items: ${error}`)
          throw error
        }
      }
    }

    if (iterationCount === maxIterations) {
      // eslint-disable-next-line no-console
      console.warn('Reached maximum iterations without emptying the project')
    }
  }

  async updateBoardMeta(graphqlWithAuth: typeof graphql, projectId: string, board: Board): Promise<void> {
    const query = `
    mutation UpdateBoardMeta($projectId: String!, $title: String!, $shortDescription: String!) {
      updateProjectV2(
        input: {
          projectId: $projectId,
          title: $title,
          shortDescription: $shortDescription
        }
      ) {
        projectV2 {
          id
        }
      }
    }
  `

    const variables = {
      projectId,
      title: board.name,
      shortDescription: board.description
    }

    try {
      await graphqlWithAuth(query, variables)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to update board meta: ${error}`)
      throw error
    }
  }
  async addCard(graphqlWithAuth: typeof graphql, projectId: string, card: Card): Promise<string> {
    const query = `
    mutation AddCard($projectId: String!, $title: String!, $body: String!) {
      addProjectV2DraftIssue(
        input: {
          projectId: $projectId,
          title: $title,
          body: $body
        }
      ) {
        projectItem {
          id
        }
      }
    }
  `

    const variables = {
      projectId,
      title: this.sanitizeName(card.title),
      body: card.body
    }

    try {
      const cardQuery: GraphQlQueryResponseData = await graphqlWithAuth(query, variables)
      return cardQuery.addProjectV2DraftIssue.projectItem.id
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to add card: ${error}`)
      throw error
    }
  }

  async updateCardStatus(
    graphqlWithAuth: typeof graphql,
    projectId: string,
    cardId: string,
    columnId: string,
    valueId: string | undefined
  ): Promise<void> {
    if (valueId) {
      const query = `
      mutation UpdateCardStatus($projectId: String!, $itemId: String!, $fieldId: String!, $valueId: String!) {
        updateProjectV2ItemFieldValue(input:{
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: {
            singleSelectOptionId: $valueId
          }
        }) {
          projectV2Item {
            id
          }
        }
      }
    `

      const variables = {
        projectId,
        itemId: cardId,
        fieldId: columnId,
        valueId
      }

      try {
        await graphqlWithAuth(query, variables)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`Failed to update card status: ${error}`)
        throw error
      }
    }
  }
}
