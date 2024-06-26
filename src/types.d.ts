export interface Config {
  organization: boolean
  cards_path?: string
  boards?: string
  delimiter?: string
  use_delimiter: boolean
  development_mode: boolean
  column_name: string
  token?: string | null
}

export interface Board {
  name: string
  description?: string
  owner: string
  board_id: number
  content: string[]
}

export interface Card {
  title: string
  body?: string
  column?: string
}

export interface SelcetOption {
  id: string
  name: string
}
