
import React, { useState, useEffect, useCallback, useRef } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { GameState, Player, Card, GamePhase, SET_LIMITS, PropertySet } from './types';
import CardUI from './components/CardUI';
import { INITIAL_DECK as RAW_DECK } from './constants';
import { getAIMoves } from './services/geminiAi';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [lobbyMode, setLobbyMode] = useState<'MAIN' | 'HOST' | 'JOIN'>('MAIN');
  const [peerId, setPeerId] = useState<string>('');
  const [joinId, setJoinId] = useState<string>('');
  const [multiStatus, setMultiStatus] = useState<string>('');
  
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const aiProcessingRef = useRef(false);

  // --- Multiplayer Logic ---

  const initMultiplayer = useCallback((mode: 'HOST' | 'JOIN') => {
    // Generate a simple 5-char code for Peer ID
    const customId = Math.random().toString(36).substring(2, 7).toUpperCase();
    const peer = new Peer(mode === 'HOST' ? customId : undefined);
    peerRef.current = peer;

    peer.on('open', (id) => {
      setPeerId(id);
      if (mode === 'HOST') {
        setMultiStatus('Waiting for your wife to join...');
      } else {
        setMultiStatus('Enter the Room Code to join');
      }
    });

    peer.on('connection', (conn) => {
      connRef.current = conn;
      setupConnection(conn);
    });

    peer.on('error', (err) => {
      console.error(err);
      setMultiStatus(`Error: ${err.type}`);
    });
  }, []);

  const connectToHost = () => {
    if (!joinId || !peerRef.current) return;
    const conn = peerRef.current.connect(joinId.toUpperCase());
    connRef.current = conn;
    setupConnection(conn);
  };

  const setupConnection = (conn: DataConnection) => {
    conn.on('open', () => {
      setMultiStatus('Connected! Starting game...');
      if (peerId === joinId) {
        // I am the joiner
      } else {
        // I am the host, initialize game
        setTimeout(() => initializeGame(false, true), 1000);
      }
    });

    conn.on('data', (data: any) => {
      if (data.type === 'STATE_UPDATE') {
        setGameState(data.state);
      }
    });

    conn.on('close', () => {
      setMultiStatus('Connection lost.');
      setGameState(null);
      setLobbyMode('MAIN');
    });
  };

  const syncState = (state: GameState) => {
    if (connRef.current && connRef.current.open) {
      connRef.current.send({ type: 'STATE_UPDATE', state });
    }
  };

  // --- Core Engine ---

  const shuffle = <T,>(array: T[]): T[] => {
    const newArr = [...array];
    for (let i = newArr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
    }
    return newArr;
  };

  const initializeGame = (vsAI: boolean = true, isMultiplayer: boolean = false) => {
    const deck = shuffle([...RAW_DECK]);
    const player1Hand = deck.splice(0, 5);
    const player2Hand = deck.splice(0, 5);

    const newState: GameState = {
      players: [
        { id: 'p1', name: isMultiplayer ? 'Host' : 'Player 1', hand: player1Hand, bank: [], properties: [], isAI: false },
        { id: 'p2', name: vsAI ? 'Gemini AI' : (isMultiplayer ? 'Guest' : 'Player 2'), hand: player2Hand, bank: [], properties: [], isAI: vsAI }
      ],
      activePlayerIndex: 0,
      deck: deck,
      discardPile: [],
      phase: 'START_TURN',
      actionsRemaining: 3,
      logs: ['Game started! Master the market.'],
      winner: null,
      multiplayerRole: isMultiplayer ? (connRef.current?.peer === peerId ? 'HOST' : 'JOINER') : undefined
    };

    setGameState(newState);
    if (isMultiplayer) syncState(newState);
  };

  const checkWinCondition = (state: GameState): boolean => {
    const player = state.players[state.activePlayerIndex];
    const fullSets = player.properties.filter(p => p.isComplete).length;
    if (fullSets >= 3) {
      state.winner = player.name;
      state.phase = 'GAME_OVER';
      return true;
    }
    return false;
  };

  const processPayment = (fromPlayer: Player, toPlayer: Player, amount: number, log: string[]) => {
    let remaining = amount;
    // Bank payment
    while (remaining > 0 && fromPlayer.bank.length > 0) {
      const card = fromPlayer.bank.pop()!;
      toPlayer.bank.push(card);
      remaining -= card.value;
      log.unshift(`${fromPlayer.name} paid ${card.name} (${card.value}M) from bank.`);
    }
    // Property payment
    while (remaining > 0 && fromPlayer.properties.length > 0) {
      const setIdx = fromPlayer.properties.findIndex(p => p.cards.length > 0);
      if (setIdx === -1) break;
      const card = fromPlayer.properties[setIdx].cards.pop()!;
      if (fromPlayer.properties[setIdx].cards.length === 0) fromPlayer.properties.splice(setIdx, 1);
      
      let targetSet = toPlayer.properties.find(p => p.color === (card.color || 'ANY'));
      if (!targetSet) {
        targetSet = { color: (card.color || 'ANY') as any, cards: [], isComplete: false };
        toPlayer.properties.push(targetSet);
      }
      targetSet.cards.push(card);
      targetSet.isComplete = targetSet.cards.length >= SET_LIMITS[targetSet.color];
      
      remaining -= card.value;
      log.unshift(`${fromPlayer.name} surrendered ${card.name} to settle debt.`);
    }
  };

  const executeMove = useCallback((type: 'BANK' | 'PROPERTY' | 'ACTION_PLAY', cardId: string) => {
    setGameState(prev => {
      if (!prev || prev.actionsRemaining <= 0 || prev.phase !== 'PLAY_PHASE' || prev.winner) return prev;
      
      const newState = JSON.parse(JSON.stringify(prev)) as GameState;
      const player = newState.players[newState.activePlayerIndex];
      const opponent = newState.players[1 - newState.activePlayerIndex];
      const cardIndex = player.hand.findIndex(c => c.id === cardId);
      
      if (cardIndex === -1) return prev;
      const card = player.hand[cardIndex];

      switch (type) {
        case 'BANK':
          player.hand.splice(cardIndex, 1);
          player.bank.push(card);
          newState.logs.unshift(`${player.name} banked ${card.name} (${card.value}M).`);
          break;
        case 'PROPERTY':
          if (card.type !== 'PROPERTY' && card.type !== 'WILD') return prev;
          player.hand.splice(cardIndex, 1);
          const color = card.color || 'ANY';
          let set = player.properties.find(p => p.color === color);
          if (!set) {
            set = { color: color as any, cards: [], isComplete: false };
            player.properties.push(set);
          }
          set.cards.push(card);
          set.isComplete = set.cards.length >= SET_LIMITS[set.color];
          newState.logs.unshift(`${player.name} deployed ${card.name}.`);
          break;
        case 'ACTION_PLAY':
          player.hand.splice(cardIndex, 1);
          if (card.name === 'Pass Go') {
            const drawn = newState.deck.splice(0, 2);
            player.hand.push(...drawn);
            newState.logs.unshift(`${player.name} played Pass Go: +2 cards.`);
          } else if (card.name === 'Debt Collector') {
            processPayment(opponent, player, 5, newState.logs);
          } else if (card.name === "It's My Birthday") {
            processPayment(opponent, player, 2, newState.logs);
          } else if (card.name === 'Sly Deal') {
            const stealableSets = opponent.properties.filter(p => !p.isComplete);
            if (stealableSets.length > 0) {
              const targetSet = stealableSets[0];
              const stolen = targetSet.cards.pop()!;
              if (targetSet.cards.length === 0) opponent.properties = opponent.properties.filter(p => p !== targetSet);
              let mySet = player.properties.find(p => p.color === (stolen.color || 'ANY'));
              if (!mySet) {
                mySet = { color: (stolen.color || 'ANY') as any, cards: [], isComplete: false };
                player.properties.push(mySet);
              }
              mySet.cards.push(stolen);
              mySet.isComplete = mySet.cards.length >= SET_LIMITS[mySet.color];
              newState.logs.unshift(`${player.name} stole ${stolen.name} with Sly Deal.`);
            }
          } else {
            newState.discardPile.push(card);
            newState.logs.unshift(`${player.name} played ${card.name}.`);
          }
          break;
      }

      newState.actionsRemaining -= 1;
      checkWinCondition(newState);
      if (connRef.current) syncState(newState);
      return newState;
    });
    setSelectedCardId(null);
  }, []);

  const startTurn = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'START_TURN') return prev;
      const newState = JSON.parse(JSON.stringify(prev)) as GameState;
      const player = newState.players[newState.activePlayerIndex];
      const drawCount = player.hand.length === 0 ? 5 : 2;
      const drawn = newState.deck.splice(0, drawCount);
      player.hand.push(...drawn);
      newState.actionsRemaining = 3;
      newState.phase = 'PLAY_PHASE';
      newState.logs.unshift(`${player.name} draws ${drawCount} cards.`);
      if (connRef.current) syncState(newState);
      return newState;
    });
  }, []);

  const endTurn = useCallback(() => {
    setGameState(prev => {
      if (!prev || prev.phase !== 'PLAY_PHASE') return prev;
      const nextIdx = (prev.activePlayerIndex + 1) % 2;
      const newState = {
        ...prev,
        activePlayerIndex: nextIdx,
        actionsRemaining: 3,
        phase: 'START_TURN',
        logs: [`Turn change: ${prev.players[nextIdx].name}'s turn.`, ...prev.logs]
      };
      if (connRef.current) syncState(newState);
      return newState;
    });
    setSelectedCardId(null);
  }, []);

  const handleCardClick = useCallback((cardId: string) => {
    if (gameState?.winner) return;
    setSelectedCardId(prev => (prev === cardId ? null : cardId));
  }, [gameState?.winner]);

  // --- Effects ---

  useEffect(() => {
    if (gameState?.phase === 'START_TURN') {
      const t = setTimeout(startTurn, 800);
      return () => clearTimeout(t);
    }
  }, [gameState?.phase, startTurn]);

  useEffect(() => {
    if (
      gameState && 
      gameState.players[gameState.activePlayerIndex].isAI && 
      gameState.phase === 'PLAY_PHASE' && 
      !aiProcessingRef.current &&
      !gameState.winner
    ) {
      const runAI = async () => {
        aiProcessingRef.current = true;
        setIsProcessing(true);
        try {
          const moves = await getAIMoves(gameState);
          for (const move of moves) {
            const current = await new Promise<GameState>(r => setGameState(s => { r(s!); return s; }));
            if (current.actionsRemaining <= 0 || current.winner) break;
            if (move.action === 'END_TURN') break;
            if (move.cardId) {
              const canPlay = current.players[current.activePlayerIndex].hand.some(c => c.id === move.cardId);
              if (canPlay) {
                const type = move.action === 'ACTION_PLAY' ? 'ACTION_PLAY' : move.action === 'BANK' ? 'BANK' : 'PROPERTY';
                executeMove(type, move.cardId);
                await new Promise(r => setTimeout(r, 1500));
              }
            }
          }
        } finally {
          endTurn();
          setIsProcessing(false);
          aiProcessingRef.current = false;
        }
      };
      runAI();
    }
  }, [gameState?.activePlayerIndex, gameState?.phase, executeMove, endTurn, gameState?.winner]);

  // --- Rendering ---

  if (!gameState) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#0f172a] text-white p-6 overflow-y-auto">
        <div className="relative mb-12 group">
          <div className="absolute -inset-1 bg-gradient-to-r from-amber-600 to-blue-600 rounded-3xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
          <div className="relative bg-slate-900 px-12 py-8 rounded-3xl border border-white/10 text-center">
            <h1 className="text-6xl font-black mb-2 text-transparent bg-clip-text bg-gradient-to-br from-yellow-300 via-amber-500 to-orange-600 tracking-tighter italic">MONOPOLY DEAL</h1>
            <p className="text-slate-500 font-bold uppercase tracking-[0.5em] text-xs">Global Digital Edition</p>
          </div>
        </div>

        {lobbyMode === 'MAIN' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
            <button onClick={() => initializeGame(true)} className="group relative p-6 bg-slate-800/40 border border-white/10 rounded-3xl hover:border-amber-500/50 transition duration-300 text-left">
              <div className="w-12 h-12 bg-amber-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-amber-500/20">
                <i className="fa-solid fa-robot text-slate-900 text-xl"></i>
              </div>
              <h3 className="text-xl font-bold mb-1">VS Gemini AI</h3>
              <p className="text-slate-500 text-sm">Challenge the advanced AI on your own.</p>
            </button>
            <button onClick={() => { setLobbyMode('HOST'); initMultiplayer('HOST'); }} className="group relative p-6 bg-slate-800/40 border border-white/10 rounded-3xl hover:border-blue-500/50 transition duration-300 text-left">
              <div className="w-12 h-12 bg-blue-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20">
                <i className="fa-solid fa-earth-americas text-white text-xl"></i>
              </div>
              <h3 className="text-xl font-bold mb-1">Host Remote Game</h3>
              <p className="text-slate-500 text-sm">Create a room for your wife to join.</p>
            </button>
            <button onClick={() => setLobbyMode('JOIN')} className="group relative p-6 bg-slate-800/40 border border-white/10 rounded-3xl hover:border-emerald-500/50 transition duration-300 text-left">
              <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20">
                <i className="fa-solid fa-key text-white text-xl"></i>
              </div>
              <h3 className="text-xl font-bold mb-1">Join with Code</h3>
              <p className="text-slate-500 text-sm">Enter a room code from another player.</p>
            </button>
            <button onClick={() => initializeGame(false)} className="group relative p-6 bg-slate-800/40 border border-white/10 rounded-3xl hover:border-slate-400/50 transition duration-300 text-left">
              <div className="w-12 h-12 bg-slate-700 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
                <i className="fa-solid fa-users text-white text-xl"></i>
              </div>
              <h3 className="text-xl font-bold mb-1">Local 2 Player</h3>
              <p className="text-slate-500 text-sm">Pass and play on the same device.</p>
            </button>
          </div>
        )}

        {lobbyMode === 'HOST' && (
          <div className="max-w-md w-full bg-slate-800/50 border border-white/10 p-8 rounded-[2.5rem] text-center animate-in zoom-in duration-300">
             <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-6 relative">
                <div className="pulse-ring"></div>
                <i className="fa-solid fa-broadcast-tower text-blue-400 text-2xl"></i>
             </div>
             <h2 className="text-2xl font-black mb-2 uppercase tracking-tight">Your Room Code</h2>
             <div className="bg-slate-900 py-4 px-8 rounded-2xl border border-blue-500/30 text-4xl font-black tracking-[0.5em] text-blue-400 mb-6 font-mono">
               {peerId || '...'}
             </div>
             <p className="text-slate-400 text-sm mb-8">{multiStatus}</p>
             <button onClick={() => { peerRef.current?.destroy(); setLobbyMode('MAIN'); }} className="w-full py-4 bg-slate-700 hover:bg-slate-600 rounded-2xl font-bold transition">CANCEL</button>
          </div>
        )}

        {lobbyMode === 'JOIN' && (
          <div className="max-w-md w-full bg-slate-800/50 border border-white/10 p-8 rounded-[2.5rem] text-center animate-in zoom-in duration-300">
             <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <i className="fa-solid fa-plug text-emerald-400 text-2xl"></i>
             </div>
             <h2 className="text-2xl font-black mb-6 uppercase tracking-tight">Enter Code</h2>
             <input 
              type="text" 
              value={joinId}
              onChange={(e) => setJoinId(e.target.value.toUpperCase())}
              placeholder="E.G. ABCDE"
              className="w-full bg-slate-900 border-2 border-slate-700 focus:border-emerald-500 rounded-2xl py-4 px-6 text-center text-3xl font-black tracking-[0.5em] font-mono mb-4 outline-none transition"
             />
             <button 
              onClick={() => { initMultiplayer('JOIN'); setTimeout(connectToHost, 1000); }} 
              className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-black text-white shadow-xl shadow-emerald-900/20 transition mb-4 active:scale-95"
             >
                CONNECT
             </button>
             <button onClick={() => setLobbyMode('MAIN')} className="w-full py-4 bg-slate-700 hover:bg-slate-600 rounded-2xl font-bold transition">BACK</button>
          </div>
        )}
      </div>
    );
  }

  const currentPlayer = gameState.players[gameState.activePlayerIndex];
  const opponent = gameState.players[1 - gameState.activePlayerIndex];
  const isMyTurn = (connRef.current) 
    ? (gameState.multiplayerRole === 'HOST' ? gameState.activePlayerIndex === 0 : gameState.activePlayerIndex === 1)
    : true;

  return (
    <div className="h-screen bg-[#020617] flex flex-col overflow-hidden select-none text-slate-200">
      
      {/* HUD */}
      <div className="h-16 bg-slate-900/90 backdrop-blur-md flex items-center justify-between px-6 border-b border-white/5 z-20">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Turn Of</span>
            <span className={`font-black text-lg ${gameState.activePlayerIndex === 0 ? 'text-blue-400' : 'text-amber-400'}`}>
              {currentPlayer.name.toUpperCase()} {isMyTurn ? '(YOU)' : ''}
            </span>
          </div>
          <div className="h-10 w-[1px] bg-white/10" />
          <div className="flex items-center gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className={`w-3 h-3 rounded-full transition-all duration-500 ${i <= gameState.actionsRemaining ? 'bg-amber-500 shadow-[0_0_10px_#f59e0b]' : 'bg-slate-700'}`} />
            ))}
            <span className="text-xs font-bold text-amber-500 ml-1 uppercase">{gameState.actionsRemaining} Actions Left</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {connRef.current && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
               <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
               <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-tighter">Live Session</span>
            </div>
          )}
          <button onClick={() => setShowLog(!showLog)} className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center hover:bg-slate-700 transition">
            <i className="fa-solid fa-list-ul text-sm"></i>
          </button>
          <button onClick={() => { peerRef.current?.destroy(); setGameState(null); setLobbyMode('MAIN'); }} className="px-4 h-10 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 flex items-center gap-2 hover:bg-red-500/20 transition font-bold text-xs uppercase tracking-tighter">
            <i className="fa-solid fa-arrow-left"></i> Menu
          </button>
        </div>
      </div>

      <div className="flex-1 flex p-4 gap-4 overflow-hidden relative">
        
        {/* Left Panel: Opponent Assets */}
        <div className={`flex-1 flex flex-col rounded-[2.5rem] p-6 transition-all duration-700 overflow-y-auto custom-scrollbar bg-slate-900/40 border border-white/5`}>
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center border border-white/10">
                <i className="fa-solid fa-user-circle text-slate-400"></i>
              </div>
              <span className="font-black text-xl tracking-tight opacity-50">{opponent.name}</span>
            </div>
            <div className="flex gap-3">
               <div className="bg-emerald-500/5 px-3 py-1 rounded-xl border border-emerald-500/10 text-emerald-500/60 font-bold text-sm">
                 {opponent.bank.reduce((s, c) => s + c.value, 0)}M
               </div>
               <div className="bg-amber-500/5 px-3 py-1 rounded-xl border border-amber-500/10 text-amber-500/60 font-bold text-sm">
                 {opponent.properties.filter(p => p.isComplete).length}/3 SETS
               </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {opponent.properties.map((set, i) => (
              <div key={i} className={`relative p-2 rounded-2xl bg-white/5 border transition-all ${set.isComplete ? 'border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.05)]' : 'border-white/5'}`}>
                 <div className="flex -space-x-12 hover:space-x-2 transition-all duration-500 overflow-visible h-28 items-center justify-center">
                    {set.cards.map(c => <CardUI key={c.id} card={c} size="sm" className="shadow-xl" />)}
                 </div>
              </div>
            ))}
          </div>

          <div className="mt-auto flex gap-1 justify-center opacity-20">
            {opponent.hand.map((_, i) => (
              <div key={i} className="w-8 h-12 bg-slate-800 rounded-md border border-slate-700" />
            ))}
          </div>
        </div>

        {/* Center: Deck/Discard */}
        <div className="w-24 flex flex-col items-center justify-center gap-8 py-10">
          <div className="relative group cursor-help">
            <div className="w-16 h-24 bg-blue-700 rounded-xl border-2 border-white/20 shadow-2xl transform rotate-3 translate-x-1"></div>
            <div className="absolute top-0 w-16 h-24 bg-blue-600 rounded-xl border-2 border-white/40 shadow-2xl flex items-center justify-center -rotate-2">
              <span className="font-black text-xl text-white">{gameState.deck.length}</span>
            </div>
          </div>
          <div className="w-16 h-24 rounded-xl border-2 border-dashed border-white/5 flex items-center justify-center p-2 text-center text-[10px] font-black text-white/10 uppercase tracking-tighter italic">
            {gameState.discardPile.length > 0 ? gameState.discardPile[gameState.discardPile.length - 1].name : 'Discard'}
          </div>
        </div>

        {/* Right Panel: Your Assets */}
        <div className={`flex-1 flex flex-col rounded-[2.5rem] p-6 transition-all duration-700 overflow-y-auto custom-scrollbar ${isMyTurn ? 'bg-blue-600/5 border border-blue-500/30' : 'bg-slate-900/40 border border-white/5'}`}>
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border transition-all ${isMyTurn ? 'bg-blue-600 border-blue-400 shadow-[0_0_15px_rgba(37,99,235,0.3)]' : 'bg-slate-800 border-white/10'}`}>
                <i className={`fa-solid fa-user ${isMyTurn ? 'text-white' : 'text-slate-500'}`}></i>
              </div>
              <span className="font-black text-xl tracking-tight uppercase tracking-widest">{isMyTurn ? 'Your Strategy' : 'Opponent Thinking'}</span>
            </div>
            <div className="flex gap-3">
               <div className="bg-emerald-500/10 px-3 py-1 rounded-xl border border-emerald-500/20 text-emerald-400 font-bold text-sm">
                 {currentPlayer.bank.reduce((s, c) => s + c.value, 0)}M
               </div>
               <div className="bg-amber-500/10 px-3 py-1 rounded-xl border border-amber-500/20 text-amber-400 font-bold text-sm">
                 {currentPlayer.properties.filter(p => p.isComplete).length}/3 SETS
               </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-6 mb-8 flex-1">
            {currentPlayer.properties.map((set, i) => (
              <div key={i} className={`relative p-3 rounded-2xl bg-white/5 border transition-all ${set.isComplete ? 'border-amber-500/80 shadow-[0_0_30px_rgba(245,158,11,0.1)]' : 'border-white/10'}`}>
                 <div className="flex -space-x-12 hover:space-x-2 transition-all duration-500 pb-2 overflow-visible h-32 items-center justify-center">
                    {set.cards.map(c => <CardUI key={c.id} card={c} size="sm" className="shadow-2xl hover:-translate-y-4" />)}
                 </div>
                 <div className="absolute bottom-2 right-3 text-[10px] font-black text-white/10 uppercase tracking-widest">{set.color}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-4 bg-slate-900/60 rounded-3xl border border-white/5 min-h-[200px] flex flex-wrap items-center justify-center gap-3">
             {isMyTurn ? currentPlayer.hand.map(card => (
               <CardUI 
                key={card.id} 
                card={card} 
                selected={selectedCardId === card.id}
                onClick={() => handleCardClick(card.id)}
                disabled={!isMyTurn || isProcessing}
               />
             )) : (
                <div className="flex flex-col items-center gap-4 opacity-40">
                  <div className="flex gap-2 animate-pulse">
                    {[1,2,3].map(i => <div key={i} className="w-10 h-16 bg-slate-800 rounded-lg border border-slate-700" />)}
                  </div>
                  <span className="text-xs font-black uppercase tracking-[0.4em] text-slate-500 animate-pulse">Waiting for network...</span>
                </div>
             )}
          </div>
        </div>
      </div>

      {/* Footer Controls */}
      <div className="h-28 bg-slate-900 border-t border-white/5 flex items-center justify-center gap-6 px-10 relative">
        {selectedCardId && isMyTurn ? (
          <div className="flex items-center gap-4 animate-in slide-in-from-bottom-8 duration-500">
            <button 
              onClick={() => executeMove('BANK', selectedCardId)}
              className="px-10 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black shadow-xl transition active:scale-95 border-b-4 border-emerald-800 flex items-center gap-3"
            >
              <i className="fa-solid fa-piggy-bank"></i> BANK
            </button>
            <button 
              onClick={() => executeMove('PROPERTY', selectedCardId)}
              disabled={['MONEY'].includes(currentPlayer.hand.find(c => c.id === selectedCardId)?.type || '')}
              className="px-10 py-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-30 text-white rounded-2xl font-black shadow-xl transition active:scale-95 border-b-4 border-amber-800 flex items-center gap-3"
            >
              <i className="fa-solid fa-city"></i> ASSET
            </button>
            <button 
              onClick={() => executeMove('ACTION_PLAY', selectedCardId)}
              disabled={!['ACTION', 'RENT'].includes(currentPlayer.hand.find(c => c.id === selectedCardId)?.type || '')}
              className="px-10 py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white rounded-2xl font-black shadow-xl transition active:scale-95 border-b-4 border-blue-800 flex items-center gap-3"
            >
              <i className="fa-solid fa-play"></i> PLAY
            </button>
            <button 
              onClick={() => setSelectedCardId(null)}
              className="w-14 h-14 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-2xl transition flex items-center justify-center border border-white/5"
            >
              <i className="fa-solid fa-times text-xl"></i>
            </button>
          </div>
        ) : (
          <button 
            onClick={endTurn}
            disabled={!isMyTurn || isProcessing || gameState.phase !== 'PLAY_PHASE'}
            className="group relative px-20 py-5 bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:opacity-10 text-white rounded-2xl font-black tracking-[0.4em] shadow-2xl transition-all active:scale-95 border-b-4 border-red-900 overflow-hidden"
          >
            END TURN
            <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition rounded-2xl"></div>
          </button>
        )}
      </div>

      {/* Overlays */}
      {showLog && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-end p-6 pointer-events-none">
           <div className="w-full max-w-sm bg-slate-900 border border-white/10 rounded-[2.5rem] shadow-2xl flex flex-col p-8 pointer-events-auto animate-in slide-in-from-right-20 duration-500 h-full max-h-[85vh]">
             <div className="flex justify-between items-center mb-8 border-b border-white/5 pb-6">
               <span className="font-black text-2xl tracking-tight text-amber-500">HISTORY</span>
               <button onClick={() => setShowLog(false)} className="w-10 h-10 rounded-full hover:bg-white/5 flex items-center justify-center transition"><i className="fa-solid fa-times"></i></button>
             </div>
             <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-2">
                {gameState.logs.map((log, i) => (
                  <div key={i} className="p-4 bg-slate-800/50 rounded-2xl border-l-4 border-amber-500 text-xs font-bold leading-relaxed shadow-sm uppercase tracking-wider">
                    {log}
                  </div>
                ))}
             </div>
           </div>
        </div>
      )}

      {isProcessing && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 px-10 py-4 bg-amber-500 text-slate-950 rounded-full font-black animate-bounce z-[60] shadow-[0_30px_60px_rgba(245,158,11,0.4)] border-4 border-slate-950 flex items-center gap-4 italic uppercase">
           <div className="w-3 h-3 bg-slate-950 rounded-full animate-ping" />
           Gemini is calculating...
        </div>
      )}

      {gameState.winner && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-2xl flex items-center justify-center z-[100] animate-in fade-in duration-1000">
           <div className="max-w-xl w-full mx-6 bg-slate-900 border-2 border-white/10 p-16 rounded-[4rem] text-center shadow-[0_0_100px_rgba(245,158,11,0.05)] relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent animate-pulse" />
              <h2 className="text-7xl font-black text-white mb-4 uppercase tracking-tighter italic drop-shadow-2xl">{gameState.winner}</h2>
              <p className="text-amber-500 font-black text-2xl mb-12 tracking-widest uppercase">The Monopoly King</p>
              <button onClick={() => { setGameState(null); setLobbyMode('MAIN'); }} className="w-full py-6 bg-white text-slate-950 font-black rounded-3xl transition transform hover:scale-105 active:scale-95 shadow-2xl tracking-widest">RETURN TO MENU</button>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;
