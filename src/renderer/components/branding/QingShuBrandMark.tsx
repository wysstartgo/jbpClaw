import React from 'react';

interface QingShuBrandMarkProps {
  className?: string;
  iconClassName?: string;
}

const QingShuBrandMark: React.FC<QingShuBrandMarkProps> = ({
  className = 'relative flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-red-600 shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_3px_10px_rgba(220,38,38,0.42)] ring-1 ring-white/45',
  iconClassName = 'text-[10px] font-semibold leading-none text-white',
}) => {
  return (
    <span className={className} aria-hidden="true">
      <span className={iconClassName}>聚</span>
      <span className="absolute inset-[2px] rounded-full border border-white/18" />
    </span>
  );
};

export default QingShuBrandMark;
