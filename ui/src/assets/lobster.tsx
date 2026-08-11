// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import React from 'react';

interface LobsterIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

export const LobsterIcon: React.FC<LobsterIconProps> = ({ className, ...props }) => (
  <svg
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    <defs>
      <linearGradient id="lobster-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#ff4d4d"/>
        <stop offset="100%" stopColor="#991b1b"/>
      </linearGradient>
    </defs>
    <g>
      <animateTransform attributeName="transform" type="translate" additive="sum"
        values="0 0; 0 -5; 0 0" keyTimes="0; 0.5; 1" dur="4s" repeatCount="indefinite"
        calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1"/>
      <path d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z" fill="url(#lobster-gradient)"/>
      <path d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z" fill="url(#lobster-gradient)">
        <animateTransform attributeName="transform" type="rotate"
          values="0 26 53; 0 26 53; -8 26 53; 0 26 53; 0 26 53" keyTimes="0; 0.85; 0.9; 0.95; 1"
          dur="4s" repeatCount="indefinite"
          calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1"/>
      </path>
      <path d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z" fill="url(#lobster-gradient)">
        <animateTransform attributeName="transform" type="rotate"
          values="0 94 53; 0 94 53; -8 94 53; 0 94 53; 0 94 53" keyTimes="0; 0.85; 0.9; 0.95; 1"
          dur="4s" begin="0.2s" repeatCount="indefinite"
          calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1"/>
      </path>
      <path d="M45 15 Q35 5 30 8" stroke="#ff4d4d" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate"
          values="0 37.5 11; -3 37.5 11; 3 37.5 11; 0 37.5 11" keyTimes="0; 0.25; 0.75; 1"
          dur="2s" repeatCount="indefinite"
          calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1"/>
      </path>
      <path d="M75 15 Q85 5 90 8" stroke="#ff4d4d" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate"
          values="0 82.5 11; -3 82.5 11; 3 82.5 11; 0 82.5 11" keyTimes="0; 0.25; 0.75; 1"
          dur="2s" repeatCount="indefinite"
          calcMode="spline" keySplines="0.42 0 0.58 1; 0.42 0 0.58 1; 0.42 0 0.58 1"/>
      </path>
      <circle cx="45" cy="35" r="6" fill="#050810"/>
      <circle cx="75" cy="35" r="6" fill="#050810"/>
      <circle cx="46" cy="34" r="2.5" fill="#00e5cc">
        <animate attributeName="opacity" values="1; 1; 0.3; 1" keyTimes="0; 0.9; 0.95; 1" dur="3s" repeatCount="indefinite"/>
      </circle>
      <circle cx="76" cy="34" r="2.5" fill="#00e5cc">
        <animate attributeName="opacity" values="1; 1; 0.3; 1" keyTimes="0; 0.9; 0.95; 1" dur="3s" repeatCount="indefinite"/>
      </circle>
    </g>
  </svg>
);