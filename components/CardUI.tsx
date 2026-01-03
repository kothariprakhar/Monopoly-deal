
import React from 'react';
import { Card, COLOR_MAP } from '../types';

interface CardUIProps {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

const CardUI: React.FC<CardUIProps> = ({ card, onClick, selected, disabled, className, size = 'md' }) => {
  const getCardStyle = () => {
    if (card.type === 'MONEY') return 'bg-emerald-100 text-emerald-900 border-emerald-400';
    if (card.type === 'ACTION') return 'bg-amber-50 text-amber-900 border-amber-400';
    if (card.type === 'RENT') return 'bg-slate-100 text-slate-900 border-slate-400';
    return 'bg-white text-slate-900 border-slate-200';
  };

  const sizeClasses = {
    sm: 'w-16 h-24 text-[8px]',
    md: 'w-24 h-36 text-[10px]',
    lg: 'w-32 h-48 text-xs'
  };

  const headerColor = card.color ? COLOR_MAP[card.color] : 'transparent';

  return (
    <div
      onClick={!disabled ? onClick : undefined}
      className={`
        ${sizeClasses[size]}
        relative rounded-md border-2 shadow-lg cursor-pointer transition-all duration-300 transform
        ${selected ? '-translate-y-4 ring-4 ring-blue-500 scale-105 z-10' : 'hover:-translate-y-2'}
        ${disabled ? 'opacity-50 grayscale cursor-not-allowed' : ''}
        ${getCardStyle()}
        ${className || ''}
      `}
    >
      {/* Property Header */}
      {(card.type === 'PROPERTY' || card.type === 'WILD') && card.color && (
        <div 
          className="absolute top-0 left-0 right-0 h-1/4 rounded-t-sm border-b"
          style={{ backgroundColor: headerColor }}
        />
      )}

      {/* Value Badge */}
      <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-white/80 flex items-center justify-center font-bold border border-slate-300">
        {card.value}
      </div>

      <div className="h-full pt-1/4 flex flex-col items-center justify-center p-2 text-center">
        <span className="font-bold uppercase tracking-tighter leading-tight mt-6">
          {card.name}
        </span>
        {card.description && (
          <p className="mt-2 text-[8px] italic opacity-75">{card.description}</p>
        )}
        <div className="mt-auto opacity-40 font-mono text-[8px]">
          {card.type}
        </div>
      </div>
    </div>
  );
};

export default CardUI;
