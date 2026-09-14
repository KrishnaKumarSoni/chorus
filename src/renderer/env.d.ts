import type { ChorusApi } from '../shared/api';
declare global {
  interface Window { chorus: ChorusApi }
}
export {};
