// Object rotation as the client applies it, for the renderer (and testable in Node).
import * as THREE from "three";

// The client's rotation (GameLib/Area.cpp: D3DXMatrixRotationYawPitchRoll(file1, file2, file3) in Metin2 space, z up,
// row vectors M = Rz(file3) Rx(file2) Ry(file1)) in scene space: A M^T A^T with A = model (x, y, z) -> scene (x, z, -y).
// file3 is Studio's o.yaw (vertical turn), file1 / file2 are the tilts o.roll / o.pitch.
const tmpM = new THREE.Matrix4();
export function clientRotation(o) {
  const r = (d) => THREE.MathUtils.degToRad(d || 0);
  const [y, p, z] = [r(o.roll), r(o.pitch), r(o.yaw)];
  const Rz = [[Math.cos(z), Math.sin(z), 0], [-Math.sin(z), Math.cos(z), 0], [0, 0, 1]];
  const Rx = [[1, 0, 0], [0, Math.cos(p), Math.sin(p)], [0, -Math.sin(p), Math.cos(p)]];
  const Ry = [[Math.cos(y), 0, -Math.sin(y)], [0, 1, 0], [Math.sin(y), 0, Math.cos(y)]];
  const mul = (a, b) => a.map((row, i) => b[0].map((_, j) => row.reduce((acc, _, k) => acc + a[i][k] * b[k][j], 0)));
  const M = mul(mul(Rz, Rx), Ry);
  const T = [[M[0][0], M[1][0], M[2][0]], [M[0][1], M[1][1], M[2][1]], [M[0][2], M[1][2], M[2][2]]];   // M^T (column vectors)
  const A = [[1, 0, 0], [0, 0, 1], [0, -1, 0]], At = [[1, 0, 0], [0, 0, -1], [0, 1, 0]];
  const S = mul(mul(A, T), At);
  tmpM.set(S[0][0], S[0][1], S[0][2], 0, S[1][0], S[1][1], S[1][2], 0, S[2][0], S[2][1], S[2][2], 0, 0, 0, 0, 1);
  return new THREE.Quaternion().setFromRotationMatrix(tmpM);
}
