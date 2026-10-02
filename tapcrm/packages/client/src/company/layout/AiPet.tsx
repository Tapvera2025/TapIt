import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ── Pet Definitions ──────────────────────────────────────────────────────────

export interface PetOption {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly personality: string;
}

export const PETS: readonly PetOption[] = [
  { id: 'cat',      label: 'Cat',      icon: '🐱', personality: 'Curious & Agile' },
  { id: 'dog',      label: 'Dog',      icon: '🐶', personality: 'Loyal & Energetic' },
  { id: 'tiger',    label: 'Tiger',    icon: '🐯', personality: 'Bold & Focused' },
  { id: 'elephant', label: 'Elephant', icon: '🐘', personality: 'Wise & Reliable' },
  { id: 'rabbit',   label: 'Rabbit',   icon: '🐰', personality: 'Swift & Cheerful' },
  { id: 'panda',    label: 'Panda',    icon: '🐼', personality: 'Calm & Friendly' },
  { id: 'fox',      label: 'Fox',      icon: '🦊', personality: 'Clever & Quick' },
  { id: 'unicorn',  label: 'Unicorn',  icon: '🦄', personality: 'Magical & Inspiring' },
];

const STORAGE_KEY = 'tapcrm.ai-pet';
const PET_CHANGED_EVENT = 'tapcrm:ai-pet-changed';
const NOTIFIED_KEY = 'tapcrm.ai-pet-notified';

function loadSavedPet(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function savePet(petId: string | null): void {
  try {
    if (petId) localStorage.setItem(STORAGE_KEY, petId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable — silently ignore.
  }
}

// ── Shared Hook ──────────────────────────────────────────────────────────────

export function useAiPet(): {
  activePet: PetOption | null;
  activePetId: string | null;
  setActivePetId: (id: string | null) => void;
} {
  const [activePetId, setActivePetIdState] = useState<string | null>(loadSavedPet);

  useEffect(() => {
    function onChanged(): void {
      setActivePetIdState(loadSavedPet());
    }
    window.addEventListener(PET_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(PET_CHANGED_EVENT, onChanged);
  }, []);

  function setActivePetId(id: string | null): void {
    setActivePetIdState(id);
    savePet(id);
    window.dispatchEvent(new Event(PET_CHANGED_EVENT));
  }

  const activePet = PETS.find((p) => p.id === activePetId) ?? null;
  return { activePet, activePetId, setActivePetId };
}

// ── Articulated SVG Animal Characters ────────────────────────────────────────

interface SvgPetProps {
  readonly petId: string;
  readonly isWalking?: boolean;
  readonly className?: string;
}

export function AnimatedSvgPet({ petId, isWalking = true, className = '' }: SvgPetProps): React.JSX.Element {
  const walkClass = isWalking ? 'pet-is-walking' : '';

  switch (petId) {
    case 'cat':
      return (
        <svg viewBox="0 0 64 48" className={`overflow-visible ${walkClass} ${className}`}>
          {/* Ground shadow */}
          <ellipse cx="30" cy="44" rx="20" ry="2.5" className="pet-shadow fill-black/20 dark:fill-black/40" />

          {/* Far Legs (Back ground) */}
          <g className="pet-leg pet-leg-back-far" style={{ transformOrigin: '19px 28px' }}>
            <rect x="17" y="27" width="5" height="15" rx="2.5" fill="#D97706" />
            <rect x="17" y="38" width="5" height="4" rx="2" fill="#FEF3C7" />
          </g>
          <g className="pet-leg pet-leg-front-far" style={{ transformOrigin: '37px 28px' }}>
            <rect x="35" y="27" width="5" height="15" rx="2.5" fill="#D97706" />
            <rect x="35" y="38" width="5" height="4" rx="2" fill="#FEF3C7" />
          </g>

          {/* Tail */}
          <g className="pet-tail" style={{ transformOrigin: '14px 24px' }}>
            <path d="M 14 24 C 8 22, 5 13, 9 9 C 11 7, 13 9, 12 12 C 10 16, 12 20, 16 22 Z" fill="#F59E0B" />
          </g>

          {/* Torso & Head Bobber */}
          <g className="pet-body-group">
            {/* Torso */}
            <rect x="14" y="19" width="28" height="15" rx="7.5" fill="#F59E0B" />
            {/* White chest bib */}
            <ellipse cx="36" cy="27" rx="5" ry="6" fill="#FEF3C7" />

            {/* Head */}
            <g className="pet-head" style={{ transformOrigin: '42px 20px' }}>
              {/* Ears */}
              <polygon points="36,13 39,5 43,11" fill="#F59E0B" />
              <polygon points="38,12 40,7 42,11" fill="#F472B6" />
              <polygon points="44,11 48,5 51,13" fill="#F59E0B" />
              <polygon points="45,11 48,7 49,12" fill="#F472B6" />
              {/* Head Base */}
              <circle cx="43" cy="18" r="9" fill="#F59E0B" />
              {/* Eyes */}
              <circle cx="46.5" cy="17" r="1.4" fill="#1E293B" />
              <circle cx="47" cy="16.5" r="0.5" fill="#FFFFFF" />
              {/* Pink nose */}
              <polygon points="50,19 52,19 51,20.5" fill="#F43F5E" />
              {/* Whiskers */}
              <line x1="51" y1="19" x2="57" y2="18" stroke="#FEF3C7" strokeWidth="0.8" strokeLinecap="round" />
              <line x1="51" y1="20.5" x2="56.5" y2="22.5" stroke="#FEF3C7" strokeWidth="0.8" strokeLinecap="round" />
            </g>
          </g>

          {/* Near Legs (Fore ground) */}
          <g className="pet-leg pet-leg-back-near" style={{ transformOrigin: '23px 28px' }}>
            <rect x="21" y="27" width="5.5" height="15" rx="2.75" fill="#F59E0B" />
            <rect x="21" y="38" width="5.5" height="4" rx="2" fill="#FEF3C7" />
          </g>
          <g className="pet-leg pet-leg-front-near" style={{ transformOrigin: '41px 28px' }}>
            <rect x="39" y="27" width="5.5" height="15" rx="2.75" fill="#F59E0B" />
            <rect x="39" y="38" width="5.5" height="4" rx="2" fill="#FEF3C7" />
          </g>
        </svg>
      );

    case 'dog':
      return (
        <svg viewBox="0 0 64 48" className={`overflow-visible ${walkClass} ${className}`}>
          <ellipse cx="30" cy="44" rx="20" ry="2.5" className="pet-shadow fill-black/20 dark:fill-black/40" />

          {/* Far Legs */}
          <g className="pet-leg pet-leg-back-far" style={{ transformOrigin: '19px 28px' }}>
            <rect x="17" y="27" width="5.5" height="15" rx="2.75" fill="#B45309" />
          </g>
          <g className="pet-leg pet-leg-front-far" style={{ transformOrigin: '37px 28px' }}>
            <rect x="35" y="27" width="5.5" height="15" rx="2.75" fill="#B45309" />
          </g>

          {/* Tail */}
          <g className="pet-tail" style={{ transformOrigin: '15px 23px' }}>
            <path d="M 15 23 C 9 19, 9 11, 13 8 C 14 7, 16 9, 14 12 C 12 16, 14 19, 17 21 Z" fill="#D97706" />
          </g>

          {/* Torso & Head Bobber */}
          <g className="pet-body-group">
            <rect x="15" y="19" width="28" height="15" rx="7.5" fill="#D97706" />
            <ellipse cx="36" cy="27" rx="5" ry="6" fill="#FEF3C7" />
            {/* Red collar */}
            <rect x="39" y="19" width="3" height="9" rx="1.5" fill="#EF4444" />
            <circle cx="40.5" cy="25" r="1.5" fill="#FBBF24" />

            {/* Head */}
            <g className="pet-head" style={{ transformOrigin: '43px 20px' }}>
              <circle cx="43" cy="18" r="9" fill="#D97706" />
              {/* Floppy Ear */}
              <path d="M 37 14 C 34 16, 33 23, 36 25 C 38 26, 40 22, 40 17 Z" fill="#92400E" />
              {/* Snout */}
              <ellipse cx="49" cy="19.5" rx="4.5" ry="3.5" fill="#FEF3C7" />
              <circle cx="51.5" cy="18.5" r="1.5" fill="#1E293B" />
              <circle cx="45" cy="16" r="1.4" fill="#1E293B" />
              <circle cx="45.5" cy="15.5" r="0.5" fill="#FFFFFF" />
              {/* Tiny tongue */}
              <path d="M 48.5 21.5 C 49.5 23.5, 51.5 23.5, 51.5 21.5 Z" fill="#F43F5E" />
            </g>
          </g>

          {/* Near Legs */}
          <g className="pet-leg pet-leg-back-near" style={{ transformOrigin: '23px 28px' }}>
            <rect x="21" y="27" width="5.5" height="15" rx="2.75" fill="#D97706" />
          </g>
          <g className="pet-leg pet-leg-front-near" style={{ transformOrigin: '41px 28px' }}>
            <rect x="39" y="27" width="5.5" height="15" rx="2.75" fill="#D97706" />
          </g>
        </svg>
      );

    case 'tiger':
      return (
        <svg viewBox="0 0 64 48" className={`overflow-visible ${walkClass} ${className}`}>
          <ellipse cx="30" cy="44" rx="20" ry="2.5" className="pet-shadow fill-black/20 dark:fill-black/40" />

          {/* Far Legs */}
          <g className="pet-leg pet-leg-back-far" style={{ transformOrigin: '19px 28px' }}>
            <rect x="17" y="27" width="5.5" height="15" rx="2.75" fill="#C2410C" />
          </g>
          <g className="pet-leg pet-leg-front-far" style={{ transformOrigin: '37px 28px' }}>
            <rect x="35" y="27" width="5.5" height="15" rx="2.75" fill="#C2410C" />
          </g>

          {/* Striped Tail */}
          <g className="pet-tail" style={{ transformOrigin: '14px 24px' }}>
            <path d="M 14 24 C 7 21, 5 12, 9 9 C 11 8, 12 10, 11 13 C 9 17, 11 20, 16 22 Z" fill="#EA580C" />
            <path d="M 9.5 12 L 12 14 M 8.5 17 L 11 19 M 11 21 L 13.5 22.5" stroke="#1E293B" strokeWidth="1.2" strokeLinecap="round" />
          </g>

          {/* Torso & Head Bobber */}
          <g className="pet-body-group">
            <rect x="14" y="19" width="29" height="15" rx="7.5" fill="#EA580C" />
            {/* Tiger stripes */}
            <path d="M 21 19 L 23 25 M 27 19 L 29 26 M 33 19 L 34 25" stroke="#1E293B" strokeWidth="1.8" strokeLinecap="round" />
            <ellipse cx="37" cy="27" rx="4.5" ry="5.5" fill="#FEF3C7" />

            {/* Head */}
            <g className="pet-head" style={{ transformOrigin: '43px 20px' }}>
              <polygon points="37,12 40,5 43,11" fill="#EA580C" />
              <polygon points="38,11 40,7 42,10" fill="#1E293B" />
              <polygon points="44,11 47,5 50,12" fill="#EA580C" />
              <polygon points="45,10 47,7 49,11" fill="#1E293B" />
              <circle cx="43" cy="18" r="9" fill="#EA580C" />
              {/* Forehead stripes */}
              <line x1="41" y1="11" x2="41" y2="14" stroke="#1E293B" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="43" y1="10" x2="43" y2="13" stroke="#1E293B" strokeWidth="1.2" strokeLinecap="round" />
              {/* Snout */}
              <ellipse cx="49" cy="19.5" rx="4" ry="3" fill="#FEF3C7" />
              <polygon points="49.5,19 51.5,19 50.5,20.5" fill="#F43F5E" />
              <circle cx="45" cy="16.5" r="1.4" fill="#1E293B" />
              <circle cx="45.5" cy="16" r="0.5" fill="#FFFFFF" />
            </g>
          </g>

          {/* Near Legs */}
          <g className="pet-leg pet-leg-back-near" style={{ transformOrigin: '23px 28px' }}>
            <rect x="21" y="27" width="5.5" height="15" rx="2.75" fill="#EA580C" />
            <line x1="21.5" y1="32" x2="25.5" y2="32" stroke="#1E293B" strokeWidth="1.2" strokeLinecap="round" />
          </g>
          <g className="pet-leg pet-leg-front-near" style={{ transformOrigin: '41px 28px' }}>
            <rect x="39" y="27" width="5.5" height="15" rx="2.75" fill="#EA580C" />
            <line x1="39.5" y1="32" x2="43.5" y2="32" stroke="#1E293B" strokeWidth="1.2" strokeLinecap="round" />
          </g>
        </svg>
      );

    case 'elephant':
      return (
        <svg viewBox="0 0 64 48" className={`overflow-visible ${walkClass} ${className}`}>
          <ellipse cx="30" cy="44" rx="22" ry="2.5" className="pet-shadow fill-black/20 dark:fill-black/40" />

          {/* Far Legs */}
          <g className="pet-leg pet-leg-back-far" style={{ transformOrigin: '18px 27px' }}>
            <rect x="15" y="26" width="6.5" height="16" rx="3" fill="#64748B" />
          </g>
          <g className="pet-leg pet-leg-front-far" style={{ transformOrigin: '36px 27px' }}>
            <rect x="33" y="26" width="6.5" height="16" rx="3" fill="#64748B" />
          </g>

          {/* Little tail */}
          <g className="pet-tail" style={{ transformOrigin: '13px 24px' }}>
            <path d="M 13 24 Q 9 29, 10 33" stroke="#94A3B8" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            <circle cx="10" cy="33.5" r="1.5" fill="#64748B" />
          </g>

          {/* Torso & Head Bobber */}
          <g className="pet-body-group">
            <rect x="13" y="17" width="30" height="18" rx="9" fill="#94A3B8" />

            {/* Head */}
            <g className="pet-head" style={{ transformOrigin: '43px 21px' }}>
              <circle cx="43" cy="19" r="9.5" fill="#94A3B8" />
              {/* Big ear */}
              <ellipse cx="37" cy="19" rx="5.5" ry="7.5" fill="#CBD5E1" />
              <ellipse cx="37" cy="19" rx="3.5" ry="5" fill="#FBCFE8" />
              {/* Eye */}
              <circle cx="45" cy="16.5" r="1.3" fill="#1E293B" />
              <circle cx="45.4" cy="16.1" r="0.4" fill="#FFFFFF" />
              {/* Little tusk */}
              <polygon points="48,22 52,24 48,24" fill="#FFFFFF" />
              {/* Trunk */}
              <path d="M 48 19 C 52 20, 56 24, 55 28 C 54.5 30, 52 29, 53 27 C 54 24, 50 22, 47 21" stroke="#94A3B8" strokeWidth="3.4" fill="none" strokeLinecap="round" />
            </g>
          </g>

          {/* Near Legs */}
          <g className="pet-leg pet-leg-back-near" style={{ transformOrigin: '22px 27px' }}>
            <rect x="19" y="26" width="6.5" height="16" rx="3" fill="#94A3B8" />
            {/* Toenails */}
            <circle cx="20.5" cy="40.5" r="1" fill="#E2E8F0" />
            <circle cx="23.5" cy="40.5" r="1" fill="#E2E8F0" />
          </g>
          <g className="pet-leg pet-leg-front-near" style={{ transformOrigin: '40px 27px' }}>
            <rect x="37" y="26" width="6.5" height="16" rx="3" fill="#94A3B8" />
            <circle cx="38.5" cy="40.5" r="1" fill="#E2E8F0" />
            <circle cx="41.5" cy="40.5" r="1" fill="#E2E8F0" />
          </g>
        </svg>
      );

    case 'rabbit':
      return (
        <svg viewBox="0 0 64 48" className={`overflow-visible ${walkClass} ${className}`}>
          <ellipse cx="30" cy="44" rx="18" ry="2.5" className="pet-shadow fill-black/20 dark:fill-black/40" />

          {/* Far Legs */}
          <g className="pet-leg pet-leg-back-far" style={{ transformOrigin: '19px 28px' }}>
            <rect x="17" y="28" width="5.5" height="14" rx="2.75" fill="#E2E8F0" />
          </g>
          <g className="pet-leg pet-leg-front-far" style={{ transformOrigin: '37px 28px' }}>
            <rect x="35" y="28" width="5" height="14" rx="2.5" fill="#E2E8F0" />
          </g>

          {/* Fluffy tail */}
          <g className="pet-tail" style={{ transformOrigin: '13px 25px' }}>
            <circle cx="12" cy="25" r="4.5" fill="#FFFFFF" />
          </g>

          {/* Torso & Head Bobber */}
          <g className="pet-body-group">
            <rect x="14" y="20" width="28" height="15" rx="7.5" fill="#F8FAFC" />
            <ellipse cx="34" cy="27" rx="5" ry="5.5" fill="#FFFFFF" />

            {/* Head */}
            <g className="pet-head" style={{ transformOrigin: '42px 20px' }}>
              {/* Tall bunny ears */}
              <ellipse cx="38" cy="8" rx="2.5" ry="7" fill="#F8FAFC" transform="rotate(-6 38 8)" />
              <ellipse cx="38" cy="8" rx="1.3" ry="5" fill="#FDA4AF" transform="rotate(-6 38 8)" />
              <ellipse cx="44" cy="7" rx="2.5" ry="7" fill="#F8FAFC" transform="rotate(6 44 7)" />
              <ellipse cx="44" cy="7" rx="1.3" ry="5" fill="#FDA4AF" transform="rotate(6 44 7)" />

              <circle cx="43" cy="19" r="8.5" fill="#F8FAFC" />
              <circle cx="46.5" cy="18" r="1.4" fill="#1E293B" />
              <circle cx="47" cy="17.5" r="0.5" fill="#FFFFFF" />
              <polygon points="49.5,19.5 51.5,19.5 50.5,20.8" fill="#F43F5E" />
            </g>
          </g>

          {/* Near Legs */}
          <g className="pet-leg pet-leg-back-near" style={{ transformOrigin: '23px 28px' }}>
            <rect x="21" y="28" width="5.5" height="14" rx="2.75" fill="#F8FAFC" />
          </g>
          <g className="pet-leg pet-leg-front-near" style={{ transformOrigin: '41px 28px' }}>
            <rect x="39" y="28" width="5" height="14" rx="2.5" fill="#F8FAFC" />
          </g>
        </svg>
      );

    case 'panda':
      return (
        <svg viewBox="0 0 64 48" className={`overflow-visible ${walkClass} ${className}`}>
          <ellipse cx="30" cy="44" rx="20" ry="2.5" className="pet-shadow fill-black/20 dark:fill-black/40" />

          {/* Far Legs (Black) */}
          <g className="pet-leg pet-leg-back-far" style={{ transformOrigin: '19px 28px' }}>
            <rect x="17" y="27" width="5.5" height="15" rx="2.75" fill="#0F172A" />
          </g>
          <g className="pet-leg pet-leg-front-far" style={{ transformOrigin: '37px 28px' }}>
            <rect x="35" y="27" width="5.5" height="15" rx="2.75" fill="#0F172A" />
          </g>

          {/* Small black tail */}
          <g className="pet-tail" style={{ transformOrigin: '14px 24px' }}>
            <circle cx="13" cy="24" r="3.5" fill="#1E293B" />
          </g>

          {/* Torso & Head Bobber */}
          <g className="pet-body-group">
            {/* White Body */}
            <rect x="14" y="19" width="28" height="15" rx="7.5" fill="#FFFFFF" />
            {/* Black shoulder band */}
            <path d="M 33 19 L 41 19 L 41 34 L 33 34 Z" fill="#1E293B" />

            {/* Head */}
            <g className="pet-head" style={{ transformOrigin: '43px 20px' }}>
              {/* Round black ears */}
              <circle cx="37" cy="11" r="3.5" fill="#1E293B" />
              <circle cx="47" cy="11" r="3.5" fill="#1E293B" />
              {/* White head */}
              <circle cx="43" cy="18" r="9" fill="#FFFFFF" />
              {/* Black eye patch */}
              <ellipse cx="46" cy="17" rx="3.5" ry="2.8" fill="#1E293B" transform="rotate(-15 46 17)" />
              <circle cx="46.5" cy="16.5" r="1.2" fill="#FFFFFF" />
              <circle cx="47" cy="16.5" r="0.6" fill="#1E293B" />
              {/* Nose */}
              <ellipse cx="50" cy="19.5" rx="1.5" ry="1" fill="#1E293B" />
            </g>
          </g>

          {/* Near Legs (Black) */}
          <g className="pet-leg pet-leg-back-near" style={{ transformOrigin: '23px 28px' }}>
            <rect x="21" y="27" width="5.5" height="15" rx="2.75" fill="#1E293B" />
          </g>
          <g className="pet-leg pet-leg-front-near" style={{ transformOrigin: '41px 28px' }}>
            <rect x="39" y="27" width="5.5" height="15" rx="2.75" fill="#1E293B" />
          </g>
        </svg>
      );

    case 'fox':
      return (
        <svg viewBox="0 0 64 48" className={`overflow-visible ${walkClass} ${className}`}>
          <ellipse cx="30" cy="44" rx="20" ry="2.5" className="pet-shadow fill-black/20 dark:fill-black/40" />

          {/* Far Legs with black boots */}
          <g className="pet-leg pet-leg-back-far" style={{ transformOrigin: '19px 28px' }}>
            <rect x="17" y="27" width="5" height="15" rx="2.5" fill="#C2410C" />
            <rect x="17" y="36" width="5" height="6" rx="2.5" fill="#0F172A" />
          </g>
          <g className="pet-leg pet-leg-front-far" style={{ transformOrigin: '37px 28px' }}>
            <rect x="35" y="27" width="5" height="15" rx="2.5" fill="#C2410C" />
            <rect x="35" y="36" width="5" height="6" rx="2.5" fill="#0F172A" />
          </g>

          {/* Bushy Fox Tail with White Tip */}
          <g className="pet-tail" style={{ transformOrigin: '14px 23px' }}>
            <path d="M 14 23 C 5 21, 2 12, 7 8 C 11 4, 15 10, 14 14 C 13 18, 14 20, 17 21 Z" fill="#EA580C" />
            <path d="M 7 8 C 8.5 6.5, 11 5, 12 7 C 13 8.5, 11 11, 9 10 Z" fill="#FFFFFF" />
          </g>

          {/* Torso & Head Bobber */}
          <g className="pet-body-group">
            <rect x="14" y="19" width="28" height="15" rx="7.5" fill="#EA580C" />
            {/* White fluffy chest */}
            <ellipse cx="36" cy="27" rx="5" ry="6" fill="#FFFFFF" />

            {/* Head */}
            <g className="pet-head" style={{ transformOrigin: '42px 20px' }}>
              {/* Fox pointy ears */}
              <polygon points="36,12 39,4 43,11" fill="#EA580C" />
              <polygon points="37,11 39,6 41,10" fill="#FFFFFF" />
              <polygon points="43,10 47,4 50,12" fill="#EA580C" />
              <polygon points="44,9 47,6 48,11" fill="#FFFFFF" />
              <circle cx="43" cy="18" r="8.5" fill="#EA580C" />
              {/* White muzzle/cheek */}
              <polygon points="46,18 53,20 48,24" fill="#FFFFFF" />
              <circle cx="53" cy="20" r="1.3" fill="#0F172A" />
              <circle cx="46" cy="16.5" r="1.4" fill="#0F172A" />
              <circle cx="46.4" cy="16" r="0.5" fill="#FFFFFF" />
            </g>
          </g>

          {/* Near Legs with black boots */}
          <g className="pet-leg pet-leg-back-near" style={{ transformOrigin: '23px 28px' }}>
            <rect x="21" y="27" width="5.5" height="15" rx="2.75" fill="#EA580C" />
            <rect x="21" y="36" width="5.5" height="6" rx="2.5" fill="#1E293B" />
          </g>
          <g className="pet-leg pet-leg-front-near" style={{ transformOrigin: '41px 28px' }}>
            <rect x="39" y="27" width="5.5" height="15" rx="2.75" fill="#EA580C" />
            <rect x="39" y="36" width="5.5" height="6" rx="2.5" fill="#1E293B" />
          </g>
        </svg>
      );

    case 'unicorn':
    default:
      return (
        <svg viewBox="0 0 64 48" className={`overflow-visible ${walkClass} ${className}`}>
          <ellipse cx="30" cy="44" rx="20" ry="2.5" className="pet-shadow fill-purple-500/20 dark:fill-purple-400/30" />

          {/* Far Legs with gold hooves */}
          <g className="pet-leg pet-leg-back-far" style={{ transformOrigin: '19px 28px' }}>
            <rect x="17" y="27" width="5" height="15" rx="2.5" fill="#E9D5FF" />
            <rect x="17" y="38" width="5" height="4" rx="2" fill="#FBBF24" />
          </g>
          <g className="pet-leg pet-leg-front-far" style={{ transformOrigin: '37px 28px' }}>
            <rect x="35" y="27" width="5" height="15" rx="2.5" fill="#E9D5FF" />
            <rect x="35" y="38" width="5" height="4" rx="2" fill="#FBBF24" />
          </g>

          {/* Rainbow Pastel Tail */}
          <g className="pet-tail" style={{ transformOrigin: '14px 23px' }}>
            <path d="M 14 23 C 8 20, 5 12, 10 9 C 12 8, 14 11, 13 14 C 11 18, 13 21, 16 22 Z" fill="#F472B6" />
            <path d="M 14 23 C 9 22, 7 15, 11 12 C 12 11, 13 13, 12 15 Z" fill="#38BDF8" />
          </g>

          {/* Torso & Head Bobber */}
          <g className="pet-body-group">
            <rect x="14" y="19" width="28" height="15" rx="7.5" fill="#FAF5FF" />
            {/* Sparkle flank mark */}
            <polygon points="23,24 24,26 26,27 24,28 23,30 22,28 20,27 22,26" fill="#F472B6" />

            {/* Head */}
            <g className="pet-head" style={{ transformOrigin: '42px 20px' }}>
              {/* Golden Horn */}
              <polygon points="45,10 51,0 48,11" fill="#FBBF24" />
              {/* Ears */}
              <polygon points="38,11 41,5 44,11" fill="#FAF5FF" />
              <polygon points="39,10 41,7 43,10" fill="#F472B6" />
              {/* Rainbow mane */}
              <path d="M 36 12 C 34 16, 35 22, 38 24 Z" fill="#38BDF8" />
              <path d="M 37 13 C 35 17, 36 21, 39 23 Z" fill="#F472B6" />

              <circle cx="43" cy="18" r="8.5" fill="#FAF5FF" />
              {/* Muzzle */}
              <ellipse cx="48.5" cy="20" rx="3.5" ry="2.5" fill="#FDF2F8" />
              {/* Eye with eyelashes */}
              <circle cx="45" cy="16.5" r="1.3" fill="#7C3AED" />
              <circle cx="45.4" cy="16.1" r="0.4" fill="#FFFFFF" />
            </g>
          </g>

          {/* Near Legs with gold hooves */}
          <g className="pet-leg pet-leg-back-near" style={{ transformOrigin: '23px 28px' }}>
            <rect x="21" y="27" width="5.5" height="15" rx="2.75" fill="#FAF5FF" />
            <rect x="21" y="38" width="5.5" height="4" rx="2" fill="#FBBF24" />
          </g>
          <g className="pet-leg pet-leg-front-near" style={{ transformOrigin: '41px 28px' }}>
            <rect x="39" y="27" width="5.5" height="15" rx="2.75" fill="#FAF5FF" />
            <rect x="39" y="38" width="5.5" height="4" rx="2" fill="#FBBF24" />
          </g>
        </svg>
      );
  }
}

// ── Full-Featured Coming Soon Modal ──────────────────────────────────────────

interface ComingSoonModalProps {
  readonly pet: PetOption;
  readonly onClose: () => void;
}

export function PetComingSoonModal({ pet, onClose }: ComingSoonModalProps): React.JSX.Element | null {
  const [notified, setNotified] = useState(() => {
    try {
      return localStorage.getItem(NOTIFIED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleNotifyToggle(): void {
    const nextState = !notified;
    setNotified(nextState);
    try {
      if (nextState) localStorage.setItem(NOTIFIED_KEY, 'true');
      else localStorage.removeItem(NOTIFIED_KEY);
    } catch {
      // ignore
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pet-modal-title"
        className="relative w-full max-w-[500px] overflow-hidden rounded-2xl border border-app-border bg-app-surface p-5 sm:p-6 text-app-foreground shadow-2xl animate-in zoom-in-95 duration-150"
      >
        {/* Glow backdrop decoration */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-app-accent/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-purple-500/10 blur-3xl" />

        {/* Top Header Row with Mascot, Title & Close Button */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="relative flex h-14 w-14 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-2xl border border-app-accent/30 bg-app-accent/10 shadow-inner">
              <AnimatedSvgPet petId={pet.id} isWalking={true} className="h-10 w-10 sm:h-12 sm:w-12" />
              <span className="absolute -bottom-1 -right-1 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm">
                AI
              </span>
            </div>

            <div className="min-w-0">
              <div>
                <span className="rounded-full bg-app-accent/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-app-accent">
                  Coming Soon
                </span>
              </div>
              <h3 id="pet-modal-title" className="mt-1 text-base sm:text-lg font-bold text-app-foreground">
                I am your <span className="text-app-accent">Tap AI Agent</span>
              </h3>
              <p className="text-xs text-app-muted">{pet.label} · {pet.personality}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-app-muted transition hover:bg-app-surface-raised hover:text-app-foreground"
            aria-label="Close dialog"
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Message */}
        <p className="mt-4 text-xs leading-relaxed text-app-muted">
          Your personal workplace co-pilot is currently undergoing neural training! Soon, you will be able to speak or chat directly with me right here in your workspace to handle:
        </p>

        {/* Capabilities Grid */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div className="rounded-xl border border-app-border bg-app-surface-raised/50 p-3">
            <div className="flex items-center gap-2 text-app-accent">
              <span className="text-sm">🌴</span>
              <p className="text-xs font-bold text-app-foreground">Leave Requests</p>
            </div>
            <p className="mt-1 text-[11px] text-app-muted leading-snug">
              Apply for leaves & check balances via natural voice or chat
            </p>
          </div>

          <div className="rounded-xl border border-app-border bg-app-surface-raised/50 p-3">
            <div className="flex items-center gap-2 text-app-accent">
              <span className="text-sm">⏱️</span>
              <p className="text-xs font-bold text-app-foreground">Attendance</p>
            </div>
            <p className="mt-1 text-[11px] text-app-muted leading-snug">
              Instant punch status, break alerts & shift reminders
            </p>
          </div>

          <div className="rounded-xl border border-app-border bg-app-surface-raised/50 p-3">
            <div className="flex items-center gap-2 text-app-accent">
              <span className="text-sm">💰</span>
              <p className="text-xs font-bold text-app-foreground">Payroll & Slips</p>
            </div>
            <p className="mt-1 text-[11px] text-app-muted leading-snug">
              Breakdown your monthly deductions, bonuses & taxes
            </p>
          </div>

          <div className="rounded-xl border border-app-border bg-app-surface-raised/50 p-3">
            <div className="flex items-center gap-2 text-app-accent">
              <span className="text-sm">⚡</span>
              <p className="text-xs font-bold text-app-foreground">Smart Actions</p>
            </div>
            <p className="mt-1 text-[11px] text-app-muted leading-snug">
              Approve requests, draft updates & query org directory
            </p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="mt-5 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 border-t border-app-border pt-4">
          <button
            type="button"
            onClick={handleNotifyToggle}
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition ${
              notified
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-app-border hover:bg-app-surface-raised text-app-foreground'
            }`}
          >
            <span>{notified ? '✓' : '🔔'}</span>
            <span>{notified ? 'Early Access Reserved!' : 'Notify me on launch'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-app-accent px-4 py-2 text-xs font-bold text-app-on-accent transition hover:opacity-90 active:scale-95"
          >
            Got it, thanks!
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Walking Pet in Sidebar ───────────────────────────────────────────────────

export function SidebarPet({ pet }: { pet: PetOption }): React.JSX.Element {
  const [modalOpen, setModalOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  const paused = hovered ? 'paused' : 'running';

  return (
    <>
      <div className="relative shrink-0 w-full h-12 overflow-hidden my-1">
        {/* Hover Hint Bubble */}
        {hovered && (
          <div
            className="pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2 whitespace-nowrap rounded-full border border-app-accent/30 bg-app-surface px-2.5 py-0.5 text-[10px] font-semibold text-app-accent shadow-md animate-in fade-in zoom-in-95 duration-150"
          >
            Say hello to Tap AI! 👋
          </div>
        )}

        {/*
          Patrol Walking Motion:
          - Starts at left, walks to the right FACING RIGHT (scaleX(1))
          - Pauses briefly at the right end
          - Flips to FACE LEFT (scaleX(-1)) and walks back to the left FACING LEFT
          - Pauses briefly at the left end and repeats
          - Face ALWAYS matches direction of motion!
        */}
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="absolute bottom-1 z-20 cursor-pointer border-none bg-transparent p-0 transition-transform active:scale-95"
          style={{
            animation: 'tapcrm-pet-patrol 16s ease-in-out infinite',
            animationPlayState: paused,
          }}
          aria-label={`${pet.label} AI Pet — click to view Tap AI Agent`}
          title={`Click to interact with your ${pet.label} AI Agent`}
        >
          <div className="h-10 w-12">
            <AnimatedSvgPet petId={pet.id} isWalking={!hovered} />
          </div>
        </button>

        {/* Keyframes for natural 4-legged walk cycle & patrol */}
        <style>{`
          /* Patrol horizontally across the sidebar track.
             scaleX(1) faces RIGHT while moving right.
             scaleX(-1) faces LEFT while moving left.
          */
          @keyframes tapcrm-pet-patrol {
            0% {
              left: 4px;
              transform: scaleX(1);
            }
            43% {
              left: calc(100% - 52px);
              transform: scaleX(1);
            }
            47% {
              left: calc(100% - 52px);
              transform: scaleX(1);
            }
            50% {
              left: calc(100% - 52px);
              transform: scaleX(-1);
            }
            93% {
              left: 4px;
              transform: scaleX(-1);
            }
            97% {
              left: 4px;
              transform: scaleX(-1);
            }
            100% {
              left: 4px;
              transform: scaleX(1);
            }
          }

          /* Quadruped walking gait */
          .pet-is-walking .pet-leg-front-near {
            animation: tapcrm-leg-swing-a 0.48s ease-in-out infinite;
          }
          .pet-is-walking .pet-leg-back-far {
            animation: tapcrm-leg-swing-a 0.48s ease-in-out infinite;
          }
          .pet-is-walking .pet-leg-front-far {
            animation: tapcrm-leg-swing-b 0.48s ease-in-out infinite;
          }
          .pet-is-walking .pet-leg-back-near {
            animation: tapcrm-leg-swing-b 0.48s ease-in-out infinite;
          }

          @keyframes tapcrm-leg-swing-a {
            0%   { transform: rotate(-24deg); }
            50%  { transform: rotate(24deg); }
            100% { transform: rotate(-24deg); }
          }

          @keyframes tapcrm-leg-swing-b {
            0%   { transform: rotate(24deg); }
            50%  { transform: rotate(-24deg); }
            100% { transform: rotate(24deg); }
          }

          /* Body & Head rhythmic bobbing while walking */
          .pet-is-walking .pet-body-group {
            animation: tapcrm-body-bob 0.48s ease-in-out infinite;
          }

          @keyframes tapcrm-body-bob {
            0%, 50%, 100% { transform: translateY(0); }
            25%, 75%      { transform: translateY(-1.8px); }
          }

          /* Tail wagging */
          .pet-is-walking .pet-tail {
            animation: tapcrm-tail-wag 0.48s ease-in-out infinite;
          }

          @keyframes tapcrm-tail-wag {
            0%, 100% { transform: rotate(-8deg); }
            50%      { transform: rotate(14deg); }
          }

          /* Shadow breathing */
          .pet-is-walking .pet-shadow {
            animation: tapcrm-shadow-step 0.48s ease-in-out infinite;
            transform-origin: 30px 44px;
          }

          @keyframes tapcrm-shadow-step {
            0%, 50%, 100% { transform: scaleX(1); opacity: 0.22; }
            25%, 75%      { transform: scaleX(0.85); opacity: 0.12; }
          }
        `}</style>
      </div>

      {/* Proper Modal when clicked */}
      {modalOpen && <PetComingSoonModal pet={pet} onClose={() => setModalOpen(false)} />}
    </>
  );
}

// ── Header Button + Picker Dropdown ──────────────────────────────────────────

function PetPicker({
  activePetId,
  onSelect,
  onDisable,
  onClose,
}: {
  activePetId: string | null;
  onSelect: (petId: string) => void;
  onDisable: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-app-border bg-app-surface p-3 shadow-xl animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-app-muted">
          Choose your AI Pet
        </p>
        <span className="text-[10px] font-semibold text-app-accent">Virtual Mascot</span>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {PETS.map((pet) => {
          const isSelected = activePetId === pet.id;
          return (
            <button
              key={pet.id}
              type="button"
              onClick={() => {
                onSelect(pet.id);
                onClose();
              }}
              title={`${pet.label} — ${pet.personality}`}
              className={`group flex flex-col items-center gap-1 rounded-xl p-2 text-center transition-all ${
                isSelected
                  ? 'bg-app-accent/15 ring-2 ring-app-accent shadow-sm'
                  : 'hover:bg-app-surface-raised hover:scale-105'
              }`}
            >
              <div className="h-7 w-8">
                <AnimatedSvgPet petId={pet.id} isWalking={isSelected} />
              </div>
              <span className={`text-[10px] font-bold leading-tight ${isSelected ? 'text-app-accent' : 'text-app-foreground'}`}>
                {pet.label}
              </span>
            </button>
          );
        })}
      </div>

      {activePetId && (
        <div className="mt-3 border-t border-app-border pt-2">
          <button
            type="button"
            onClick={() => {
              onDisable();
              onClose();
            }}
            className="w-full rounded-xl border border-app-border px-3 py-1.5 text-xs font-semibold text-app-muted transition hover:border-rose-400/50 hover:bg-rose-500/10 hover:text-rose-500"
          >
            Disable AI Pet
          </button>
        </div>
      )}
    </div>
  );
}

export function AiPetButton(): React.JSX.Element {
  const { activePet, activePetId, setActivePetId } = useAiPet();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setPickerOpen((prev) => !prev)}
        className={`flex items-center gap-1.5 rounded-lg border p-2 text-sm transition-all ${
          activePet
            ? 'border-app-accent/50 bg-app-accent/10 text-app-accent shadow-sm'
            : 'border-app-border text-app-muted hover:border-app-accent hover:text-app-accent'
        }`}
        aria-label={activePet ? `AI Pet: ${activePet.label}` : 'Enable AI Pet'}
        title={activePet ? `AI Pet: ${activePet.label} (click to change)` : 'Enable AI Pet'}
      >
        {activePet ? (
          <div className="h-5 w-6">
            <AnimatedSvgPet petId={activePet.id} isWalking={false} />
          </div>
        ) : (
          <span className="block text-base leading-none">🐾</span>
        )}
      </button>

      {pickerOpen && (
        <PetPicker
          activePetId={activePetId}
          onSelect={(id) => setActivePetId(id)}
          onDisable={() => setActivePetId(null)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
