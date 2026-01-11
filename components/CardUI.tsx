import React from 'react';
import { Card, COLOR_MAP, RENT_VALUES, SET_LIMITS } from '../types';

interface CardUIProps {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  isHighlighted?: boolean;
}

const CardUI: React.FC<CardUIProps> = ({ card, onClick, selected, disabled, className, size = 'md', isHighlighted }) => {
  const getCardStyle = () => {
    if (card.type === 'MONEY') return 'bg-emerald-100 text-emerald-900 border-emerald-400';
    if (card.type === 'ACTION') return 'bg-amber-50 text-amber-900 border-amber-400';
    if (card.type === 'RENT') return 'bg-slate-50 text-slate-900 border-slate-300';
    return 'bg-white text-slate-900 border-slate-200';
  };

  const sizeClasses = {
    sm: 'w-16 h-24 text-[7px]',
    md: 'w-24 h-36 text-[9px]',
    lg: 'w-32 h-48 text-[11px]'
  };

  const getHeaderBackground = () => {
    if (card.color === 'ANY') return COLOR_MAP.ANY;
    if (card.color && card.secondaryColor) {
      return `linear-gradient(to right, ${COLOR_MAP[card.color]} 50%, ${COLOR_MAP[card.secondaryColor]} 50%)`;
    }
    return card.color ? COLOR_MAP[card.color] : 'transparent';
  };

  // Extract rent values for the card's color
  const rentInfo = card.color && card.color !== 'ANY' ? RENT_VALUES[card.color] : null;
  const maxSet = card.color && card.color !== 'ANY' ? SET_LIMITS[card.color] : 0;

  return (
    <div
      onClick={!disabled ? onClick : undefined}
      className={`
        ${sizeClasses[size]}
        relative rounded-md border-2 transition-all duration-300
        ${selected && !disabled ? '-translate-y-4 ring-4 ring-blue-500 scale-105 z-10 shadow-2xl' : ''}
        ${!selected && !disabled ? 'hover:-translate-y-2 cursor-pointer' : ''}
        ${isHighlighted ? 'ring-4 ring-amber-400 animate-pulse scale-110 z-20' : ''}
        ${disabled ? 'cursor-default' : ''}
        ${getCardStyle()}
        ${className || ''}
        backface-hidden
      `}
      style={{
        transformStyle: 'preserve-3d',
        backfaceVisibility: 'hidden',
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        transform: 'translateZ(0)'
      }}
    >
      {/* Property/Rent Header */}
      {(card.type === 'PROPERTY' || card.type === 'WILD' || card.type === 'RENT') && card.color && (
        <div 
          className="absolute top-0 left-0 right-0 h-1/4 rounded-t-sm border-b overflow-hidden"
          style={{ background: getHeaderBackground() }}
        />
      )}

      {/* Value Badge */}
      <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-white/90 flex items-center justify-center font-bold border border-slate-300 shadow-sm z-20">
        {card.value}
      </div>

      <div className="h-full pt-8 flex flex-col items-center p-2 text-center">
        <span className={`font-black uppercase tracking-tighter leading-tight mt-2 ${card.type === 'RENT' ? 'text-[8px]' : ''}`}>
          {card.name}
        </span>
        
        {/* Rent Schedule Section for Properties */}
        {(card.type === 'PROPERTY' || card.type === 'WILD') && rentInfo && (
          <div className="mt-2 w-full bg-slate-100/50 rounded p-1 flex flex-col gap-0.5 border border-slate-200">
            {rentInfo.map((val, idx) => (
              <div key={idx} className="flex justify-between items-center px-1 font-mono leading-none">
                <span className="opacity-60 text-[6px] uppercase">{idx + 1} {idx + 1 === maxSet ? 'SET' : ''}</span>
                <span className="font-black text-[7px]">{val}M</span>
              </div>
            ))}
          </div>
        )}

        {card.description && (
          <p className="mt-1 text-[6px] italic opacity-75 font-medium leading-tight px-1">{card.description}</p>
        )}
        
        <div className="mt-auto opacity-30 font-mono text-[7px] font-bold pb-1">
          {card.type}
        </div>
      </div>
    </div>
  );
};

export default CardUI;