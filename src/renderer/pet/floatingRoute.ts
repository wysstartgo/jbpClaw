import { PetRendererRoute } from '../../shared/pet/constants';

export const normalizeRendererHashRoute = (hash: string): string => (
  hash.replace(/^#\/?/, '')
);

export const isPetFloatingRoute = (hash: string): boolean => (
  normalizeRendererHashRoute(hash) === PetRendererRoute.Floating
);
