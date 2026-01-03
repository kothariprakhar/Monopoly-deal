
export type PropertyColor = 
  | 'BROWN' 
  | 'LIGHT_BLUE' 
  | 'PINK' 
  | 'ORANGE' 
  | 'RED' 
  | 'YELLOW' 
  | 'GREEN' 
  | 'DARK_BLUE' 
  | 'RAILROAD' 
  | 'UTILITY'
  | 'ANY';

export type CardType = 'PROPERTY' | 'ACTION' | 'RENT' | 'MONEY' | 'WILD';

export interface Card {
  id: string;
  name: string;
  type: CardType;
  value: number;
  color?: PropertyColor;
  secondaryColor?: PropertyColor; // For multi-color wildcards
  description?: string;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  bank: Card[];
  properties: PropertySet[];
  isAI: boolean;
}

export interface PropertySet {
  color: PropertyColor;
  cards: Card[];
  isComplete: boolean;
}

export type GamePhase = 'LOBBY' | 'START_TURN' | 'PLAY_PHASE' | 'END_TURN' | 'GAME_OVER';

export interface GameState {
  players: Player[];
  activePlayerIndex: number;
  deck: Card[];
  discardPile: Card[];
  phase: GamePhase;
  actionsRemaining: number;
  logs: string[];
  winner: string | null;
  multiplayerRole?: 'HOST' | 'JOINER';
}

export const COLOR_MAP: Record<PropertyColor, string> = {
  BROWN: '#8B4513',
  LIGHT_BLUE: '#87CEEB',
  PINK: '#FF69B4',
  ORANGE: '#FFA500',
  RED: '#FF0000',
  YELLOW: '#FFFF00',
  GREEN: '#008000',
  DARK_BLUE: '#00008B',
  RAILROAD: '#000000',
  UTILITY: '#F5F5DC',
  ANY: 'linear-gradient(to bottom right, #f8fafc, #94a3b8)'
};

export const SET_LIMITS: Record<PropertyColor, number> = {
  BROWN: 2,
  LIGHT_BLUE: 3,
  PINK: 3,
  ORANGE: 3,
  RED: 3,
  YELLOW: 3,
  GREEN: 3,
  DARK_BLUE: 2,
  RAILROAD: 4,
  UTILITY: 2,
  ANY: 999
};
