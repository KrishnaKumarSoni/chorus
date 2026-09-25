import type { Transition } from 'framer-motion';

/**
 * Critically damped springs throughout: no overshoot on anything that was not
 * thrown. Springs start from the current on-screen value, so every motion here
 * can be interrupted and reversed mid-flight.
 */
export const settle: Transition = { type: 'spring', bounce: 0, duration: 0.4 };
export const gentle: Transition = { type: 'spring', bounce: 0, duration: 0.5 };
export const quick: Transition = { type: 'spring', bounce: 0, duration: 0.25 };
/** Menus, popovers and icon swaps. */
export const pop: Transition = { type: 'spring', bounce: 0, duration: 0.3 };
