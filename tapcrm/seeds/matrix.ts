// The executable permission matrix lives with organization provisioning so
// tenant bootstrap and the global seed command cannot drift apart.
export {
  CARVE_OUTS,
  MATRIX_POSITIONS,
  PERMISSION_MATRIX,
  type Cell,
  type MatrixPosition,
} from '../packages/server/src/platform/organizations/policy-matrix.js';
