import type { Transition } from 'framer-motion';

/** Critically damped by default; bounce is reserved for momentum-driven interactions. */
export const settle: Transition = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 };
export const gentle: Transition = { type: 'spring', stiffness: 260, damping: 30 };
export const quick: Transition = { type: 'spring', stiffness: 500, damping: 40 };
