export interface Config {
  cards_path?: string
  boards?: string
  delimiter?: string
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
