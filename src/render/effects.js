// Visual effects: RCS puffs, re-entry plasma, explosions and debris sparks, docking flash.
import * as THREE from 'three';
import { getGlowTexture } from './textures.js';
import { V3 } from '../core/math.js';

const POOL = 90;

export class Effects {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    scene.add(this.group);
    const tex = getGlowTexture();
    this.puffs = [];
    for (let i = 0; i < POOL; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xdfe8ff, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      s.renderOrder = 25;
      this.group.add(s);
      this.puffs.push({ s, life: 0, abs: new V3(), vel: new V3() });
    }
    this.next = 0;
    // Plasma sheath: a glowing ellipsoid and a trailing cone.
    this.plasmaMat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv;
        #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <logdepthbuf_pars_fragment>
        uniform float uI; uniform float uTime;
        varying vec3 vN; varying vec3 vV; varying vec2 vUv;
        void main(){
          #include <logdepthbuf_fragment>
          float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
          float f = sin(uTime * 23.0 + vUv.y * 40.0) * 0.15 + 0.85;
          vec3 c = mix(vec3(1.0, 0.45, 0.15), vec3(1.0, 0.85, 0.6), rim) * pow(rim, 1.5) * uI * f;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.plasma = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), this.plasmaMat);
    this.plasma.visible = false;
    this.plasma.renderOrder = 26;
    this.trail = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 24, 1, true), this.plasmaMat);
    this.trail.visible = false;
    this.trail.renderOrder = 26;
    this.group.add(this.plasma, this.trail);
    // Explosion
    this.boom = null;
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffd9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flash.visible = false;
    this.flash.renderOrder = 27;
    this.fire = [];
    for (let i = 0; i < 24; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xff8030, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.visible = false;
      s.renderOrder = 27;
      this.group.add(s);
      this.fire.push({ s, dir: new V3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).normalize(), speed: 4 + Math.random() * 22 });
    }
    const shard = new THREE.TetrahedronGeometry(0.4);
    this.shards = new THREE.InstancedMesh(shard, new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.5, metalness: 0.7, emissive: 0x331100 }), 60);
    this.shards.visible = false;
    this.shardData = Array.from({ length: 60 }, () => ({ dir: new V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), speed: 3 + Math.random() * 30, spin: Math.random() * 6, size: 0.4 + Math.random() * 1.6 }));
    this.group.add(this.flash, this.shards);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  reset() {
    for (const p of this.puffs) {
      p.life = 0;
      p.s.visible = false;
    }
    this.boom = null;
    this.flash.visible = false;
    this.shards.visible = false;
    for (const f of this.fire) f.s.visible = false;
  }

  /** Emit an RCS puff at an absolute position moving with velocity vel (sim axes). */
  puff(abs, vel) {
    const p = this.puffs[this.next];
    this.next = (this.next + 1) % POOL;
    p.abs.copy(abs);
    p.vel.copy(vel);
    p.life = 1;
    p.s.visible = true;
  }

  explode(abs, vel) {
    this.boom = { t: 0, abs: abs.clone(), vel: vel.clone() };
  }

  update(sim, r, dt) {
    const s = sim.ship;
    const shipAbs = sim.absolute(s.ref, s.pos);
    const shipVel = sim.absoluteVel(s.ref, s.vel);
    // RCS: puffs from the clusters opposite to the commanded force.
    if (!sim.paused && s.rcsEnabled && !s.destroyed && r.vessel?.thrusters?.length) {
      const a = s.rcsActivity;
      const act = Math.abs(a.trans.x) + Math.abs(a.trans.y) + Math.abs(a.trans.z) + Math.abs(a.rot.x) + Math.abs(a.rot.y) + Math.abs(a.rot.z);
      this._acc = (this._acc || 0) + act * dt * 40;
      while (this._acc > 1) {
        this._acc -= 1;
        // Pick a cluster and fire against the strongest component.
        const th = r.vessel.thrusters[Math.floor(Math.random() * r.vessel.thrusters.length)];
        const force = new V3(a.trans.x, a.trans.y, a.trans.z);
        if (force.len() < 0.05) force.set((Math.random() - 0.5), a.rot.z * 0.8 + (Math.random() - 0.5) * 0.3, -a.rot.y * 0.8 + (Math.random() - 0.5) * 0.3);
        const ex = force.clone().normalize().scale(-1); // exhaust direction in body
        const local = s.local(th, new V3());
        const wp = s.q.rotate(local, new V3()).add(shipAbs);
        const wv = s.q.rotate(ex, new V3()).scale(6 + Math.random() * 4).add(shipVel);
        this.puff(wp, wv);
      }
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt * 2.6;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      p.abs.addScaled(p.vel, dt);
      r.rel(p.abs, p.s.position);
      p.s.scale.setScalar(0.3 + (1 - p.life) * 1.6);
      p.s.material.opacity = p.life * 0.55;
    }
    // Plasma
    const flux = s.heatFlux || 0;
    const intensity = Math.min(1.6, Math.max(0, (flux - 15000) / 120000));
    this.plasma.visible = intensity > 0.01 && !s.destroyed;
    this.trail.visible = this.plasma.visible;
    if (this.plasma.visible) {
      this.plasmaMat.uniforms.uI.value = intensity * 2;
      this.plasmaMat.uniforms.uTime.value = r.elapsed;
      const vdir = s.vel.clone().normalize();
      const size = (s.def.hull?.[0]?.[3] || 2) * 1.6;
      const front = shipAbs.clone().addScaled(vdir, size * 0.5);
      r.rel(front, this.plasma.position);
      this.plasma.scale.set(size, size, size);
      const back = shipAbs.clone().addScaled(vdir, -size * 3);
      r.rel(back, this.trail.position);
      const d3 = new THREE.Vector3(vdir.x, vdir.z, -vdir.y);
      this.trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d3);
      this.trail.scale.set(size * 1.1, size * 7, size * 1.1);
    }
    // Explosion
    if (this.boom) {
      const b = this.boom;
      b.t += dt;
      const air = s.dynPressure > 0;
      this.flash.visible = b.t < 1.2;
      r.rel(b.abs, this.flash.position);
      this.flash.scale.setScalar(20 + b.t * 80);
      this.flash.material.opacity = Math.max(0, 1 - b.t / 1.2);
      for (const f of this.fire) {
        f.s.visible = b.t < 4;
        const d = f.speed * Math.min(b.t, 3) * (air ? 0.4 : 1);
        r.rel(b.abs.clone().addScaled(f.dir, d), f.s.position);
        f.s.scale.setScalar(6 + b.t * (air ? 10 : 4));
        f.s.material.opacity = Math.max(0, 0.9 - b.t / 4);
        f.s.material.color.setHSL(0.07 - b.t * 0.01, 1, Math.max(0.2, 0.6 - b.t * 0.1));
      }
      this.shards.visible = b.t < 60;
      const origin = r.rel(b.abs, new THREE.Vector3());
      for (let i = 0; i < this.shardData.length; i++) {
        const sd = this.shardData[i];
        const d = sd.speed * b.t;
        this._e.set(sd.spin * b.t, sd.spin * 0.7 * b.t, 0);
        this._q.setFromEuler(this._e);
        this._m.compose(new THREE.Vector3(origin.x + sd.dir.x * d, origin.y + sd.dir.z * d, origin.z - sd.dir.y * d), this._q, new THREE.Vector3(sd.size, sd.size, sd.size));
        this.shards.setMatrixAt(i, this._m);
      }
      this.shards.instanceMatrix.needsUpdate = true;
    }
  }
}
