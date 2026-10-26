// Grilles adaptatives : le pas affiché est une puissance de 10 × 10 mm, choisi selon la distance
// de la caméra, avec un fondu entre deux niveaux.
//   - grille au sol (plan XY), avec les axes X (rouge) et Y (vert) ; ses traits fins n'apparaissent
//     que lorsqu'on la regarde de dessus (ou de dessous), sinon seuls les grands traits restent ;
//   - grille verticale (plan XZ ou YZ), à la place du sol quand on regarde de face ou de côté.
// Une seule grille est affichée à la fois (fondu au passage). L'axe Z (bleu) est une ligne infinie.

import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PlaneGeometry,
  type PerspectiveCamera,
  Quaternion,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { ALIGN_DEG } from '../core/placement'
import type { Axis, Vec3 } from '../core/vec'
import { AXIS_COLORS, COLORS } from './colors'

const vertexShader = /* glsl */ `
  uniform vec3 uU;
  uniform vec3 uV;
  varying vec2 vPlane;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vPlane = vec2(dot(w.xyz, uU), dot(w.xyz, uV));
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

const fragmentShader = /* glsl */ `
  uniform float uStep;
  uniform float uFade;
  uniform float uFadeDist;
  uniform float uOpacity;
  uniform float uFine;
  uniform vec2 uCenter;
  uniform vec3 uColor;
  uniform vec3 uColorU;
  uniform vec3 uColorV;
  varying vec2 vPlane;

  // Couverture d'une ligne de grille de largeur w pixels.
  float lines(vec2 p, float step, float w) {
    vec2 c = p / step;
    vec2 d = abs(fract(c - 0.5) - 0.5) / fwidth(c);
    return 1.0 - min(min(d.x, d.y) / w, 1.0);
  }

  float axisLine(float x, float w) {
    return 1.0 - min(abs(x) / fwidth(x) / w, 1.0);
  }

  void main() {
    vec2 p = vPlane;
    // uFine = 1 : trois niveaux (pas, 10×, 100×). uFine = 0 : seuls les grands traits restent,
    // le niveau 10× s'effaçant à mesure que le 100× devient le niveau principal (sans saut au changement de pas).
    float minor = lines(p, uStep, 1.0) * (1.0 - uFade) * 0.22 * uFine;
    float mid = lines(p, uStep * 10.0, 1.0) * mix(0.45 * (1.0 - uFade), mix(0.45, 0.22, uFade), uFine);
    float major = lines(p, uStep * 100.0, 1.2) * mix(0.45, 0.45 * uFade, uFine);
    float a = max(max(minor, mid), major);
    vec3 col = uColor;
    // Ligne v = 0 : axe porté par u ; ligne u = 0 : axe porté par v.
    float au = axisLine(p.y, 1.6);
    float av = axisLine(p.x, 1.6);
    if (au > 0.0 || av > 0.0) {
      col = au >= av ? uColorU : uColorV;
      a = max(a, max(au, av) * 0.85);
    }
    float d = length(p - uCenter);
    a *= (1.0 - smoothstep(uFadeDist * 0.45, uFadeDist, d)) * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`

const AXIS_VEC: Record<Axis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
}

/** Une grille dans le plan des axes u et v, passant par l'origine. */
class PlaneGrid {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>
  private readonly u: Vector3
  private readonly v: Vector3
  private readonly n: Vector3

  constructor(u: Axis, v: Axis) {
    this.u = AXIS_VEC[u]
    this.v = AXIS_VEC[v]
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uU: { value: this.u },
        uV: { value: this.v },
        uStep: { value: 10 },
        uFade: { value: 0 },
        uFadeDist: { value: 1e4 },
        uOpacity: { value: 1 },
        uFine: { value: 1 },
        uCenter: { value: new Vector2() },
        uColor: { value: new Color(COLORS.grid) },
        uColorU: { value: new Color(AXIS_COLORS[u]) },
        uColorV: { value: new Color(AXIS_COLORS[v]) },
      },
    })
    this.mesh = new Mesh(new PlaneGeometry(1, 1), material)
    // La géométrie est dans le plan local XY : on l'oriente dans le plan (u, v).
    this.n = new Vector3().crossVectors(this.u, this.v)
    this.mesh.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), this.n))
    this.mesh.renderOrder = -1
    this.mesh.frustumCulled = false
  }

  /** `through` : point par lequel passe la grille (le plan est décalé le long de sa normale). */
  update(focus: Vector3, through: Vector3, step: number, fade: number, fadeDist: number, opacity: number, fine = 1): void {
    const u = this.mesh.material.uniforms
    u.uFine.value = fine
    u.uStep.value = step
    u.uFade.value = fade
    u.uFadeDist.value = fadeDist
    u.uOpacity.value = opacity
    // Centre de la grille : projection du point visé sur le plan.
    const cu = focus.dot(this.u)
    const cv = focus.dot(this.v)
    u.uCenter.value.set(cu, cv)
    this.mesh.position.copy(this.u).multiplyScalar(cu).addScaledVector(this.v, cv).addScaledVector(this.n, through.dot(this.n))
    this.mesh.scale.set(fadeDist * 2, fadeDist * 2, 1)
    this.mesh.visible = opacity > 0
  }
}

/** Au-delà de ce cosinus entre la visée et un axe, la vue est alignée : on affiche la grille de ce plan. */
const FACING_COS = Math.cos((ALIGN_DEG * Math.PI) / 180)

export class Grid {
  readonly object = new Group()
  private ground = new PlaneGrid('x', 'y')
  private front = new PlaneGrid('x', 'z')
  private side = new PlaneGrid('y', 'z')
  private zAxis: LineSegments
  /** Pas affiché, en mm. */
  step = 10

  constructor() {
    this.object.name = 'grid'
    this.object.add(this.ground.mesh, this.front.mesh, this.side.mesh)
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([0, 0, -1, 0, 0, 1], 3))
    this.zAxis = new LineSegments(g, new LineBasicMaterial({ color: AXIS_COLORS.z, transparent: true, opacity: 0.85 }))
    this.object.add(this.zAxis)
  }

  /**
   * À appeler à chaque mouvement de caméra. `focusDist` : distance de la caméra au point visé.
   * `workPoint` : point par lequel passe le plan de travail en vue alignée (dernier nœud, sinon origine).
   */
  update(camera: PerspectiveCamera, focusDist: number, workPoint: Vec3 = [0, 0, 0]): void {
    const fwd = camera.getWorldDirection(new Vector3())
    const scaleDist = Math.max(Math.abs(camera.position.z), focusDist * 0.6, 50)
    // Une maille fine ≈ 1/150 de la distance : environ 6 à 60 pixels par maille.
    const k = Math.max(0, Math.log10(scaleDist / 150 / 10))
    const level = Math.floor(k)
    this.step = 10 * 10 ** level
    const fade = k - level
    const fadeDist = Math.max(scaleDist * 12, 2000)
    const focus = camera.position.clone().addScaledVector(fwd, focusDist)

    // 1 quand on regarde droit dans l'axe, 0 au-delà de ~15°.
    const facing = (c: number) => Math.max(0, Math.min(1, (Math.abs(c) - FACING_COS) / (1 - FACING_COS) * 3))
    const front = facing(fwd.y)
    const side = facing(fwd.x)
    // Vue alignée : la grille est sur le plan de travail. Sinon le sol reste à z = 0.
    const work = new Vector3(...workPoint)
    const top = facing(fwd.z)
    this.ground.update(focus, top > 0 ? work : new Vector3(), this.step, fade, fadeDist, 1 - Math.max(front, side), top)
    this.front.update(focus, work, this.step, fade, fadeDist, front)
    this.side.update(focus, work, this.step, fade, fadeDist, side)
    // Axe Z « infini » : bien au-delà de ce que la caméra peut voir.
    this.zAxis.scale.set(1, 1, Math.max(1e5, focusDist * 100))
  }
}
