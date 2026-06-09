import React from 'react';

const SidebarKitsIcon: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg className={className} viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M9.5 8.5h6v6h-6v-6Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 8.5h6v6h-6v-6Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 17.5h6v6h-6v-6Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M18.5 17.5h6v6h-6v-6Z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M7 28h20"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default SidebarKitsIcon;
