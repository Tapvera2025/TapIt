import { createContext, useContext, useEffect, type ReactNode } from 'react';

type HeroActionsSetter = (actions: ReactNode | null) => void;

const RecruitmentHeroActionsContext = createContext<HeroActionsSetter | null>(null);

export function RecruitmentHeroActionsProvider({
  children,
  setActions,
}: {
  readonly children: ReactNode;
  readonly setActions: HeroActionsSetter;
}): React.JSX.Element {
  return (
    <RecruitmentHeroActionsContext.Provider value={setActions}>
      {children}
    </RecruitmentHeroActionsContext.Provider>
  );
}

/** Publishes the current recruitment screen action into the desktop utility capsule. */
export function useRecruitmentHeroActions(actions: ReactNode | null): void {
  const setActions = useContext(RecruitmentHeroActionsContext);

  useEffect(() => {
    if (!setActions) return;
    setActions(actions);
    return () => setActions(null);
  }, [actions, setActions]);
}
