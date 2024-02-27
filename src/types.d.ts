export interface config {
  cards_path?: string
  boards?: string
  token?: string | null
}

export interface board {
  name: string
  owner: string
  board_id: number
}
