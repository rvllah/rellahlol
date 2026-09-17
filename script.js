(() => {
  'use strict';

  const canvas = document.querySelector('#medusa');
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
  const ctx = gl ? null : canvas.getContext('2d');
  let metalRenderer = null;
  const sculpture = document.querySelector('.sculpture');
  const letters = [...document.querySelectorAll('.wordmark > span')];
  const link = document.querySelector('.destination');
  const linkWrap = document.querySelector('.link-wrap');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: -1000, y: -1000, nx: 0, ny: 0 };
  const spring = letters.map(() => ({ y: 0, velocity: 0, rotation: 0 }));
  const magnet = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let paused = motionPreference.matches;
  const space = document.querySelector('#space');
  const sky = space.getContext('2d');
  let skyWidth = 0;
  let skyHeight = 0;
  let width = 0;
  let height = 0;
  let bounds = [];
  let frame = 0;
  let lastTime = 0;
  let elapsed = 0;
  let impulse = 0;
  let tiltX = 0;
  let tiltY = 0;

  const unit = v => {
    const length = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / length, y: v.y / length, z: v.z / length };
  };
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const center = t => ({
    x: (1 + .43 * Math.cos(3 * t)) * Math.cos(2 * t),
    y: (1 + .43 * Math.cos(3 * t)) * Math.sin(2 * t),
    z: .43 * Math.sin(3 * t)
  });
  const sections = 288;
  const sides = 32;
  const vertices = [];
  const faces = [];
  const power = (value, exponent) => Math.sign(value) * Math.pow(Math.abs(value), exponent);

  for (let i = 0; i < sections; i++) {
    const t = i / sections * Math.PI * 2;
    const c = center(t);
    const before = center(t - .001);
    const after = center(t + .001);
    const tangent = unit({ x: after.x - before.x, y: after.y - before.y, z: after.z - before.z });
    const n = unit(cross(tangent, { x: 0, y: 0, z: 1 }));
    const b = unit(cross(tangent, n));
    for (let j = 0; j < sides; j++) {
      const angle = j / sides * Math.PI * 2;
      const u = power(Math.cos(angle), .92) * .265;
      const v = power(Math.sin(angle), .92) * .205;
      const nu = power(Math.cos(angle), 1.08) / .265;
      const nv = power(Math.sin(angle), 1.08) / .205;
      const normal = unit({ x: n.x * nu + b.x * nv, y: n.y * nu + b.y * nv, z: n.z * nu + b.z * nv });
      vertices.push({ x: c.x + n.x * u + b.x * v, y: c.y + n.y * u + b.y * v, z: c.z + n.z * u + b.z * v, normal });
    }
  }

  for (let i = 0; i < sections; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = ((i + 1) % sections) * sides + j;
      const c = ((i + 1) % sections) * sides + (j + 1) % sides;
      const d = i * sides + (j + 1) % sides;
      const panel = i % 36;
      const etch = (panel === 0) || ((j === 7 || j === 23) && panel >= 5 && panel <= 19) || ((panel === 5 || panel === 19) && (j === 8 || j === 24)) || ((j === 9 || j === 25) && panel >= 19 && panel <= 24);
      const normal = unit({
        x: vertices[a].normal.x + vertices[b].normal.x + vertices[c].normal.x + vertices[d].normal.x,
        y: vertices[a].normal.y + vertices[b].normal.y + vertices[c].normal.y + vertices[d].normal.y,
        z: vertices[a].normal.z + vertices[b].normal.z + vertices[c].normal.z + vertices[d].normal.z
      });
      faces.push({ indices: [a, b, c, d], normal, etch });
    }
  }

  function createMetalRenderer() {
    if (!gl) return null;
    const vertexSource = `
      attribute vec3 position;
      attribute vec3 normal;
      attribute vec2 uv;
      uniform vec3 rotation;
      uniform vec4 layout;
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec2 vUv;
      vec3 turn(vec3 p) {
        vec3 s = sin(rotation);
        vec3 c = cos(rotation);
        vec3 a = vec3(p.x * c.z - p.y * s.z, p.x * s.z + p.y * c.z, p.z);
        vec3 b = vec3(a.x, a.y * c.x - a.z * s.x, a.y * s.x + a.z * c.x);
        return vec3(b.x * c.y + b.z * s.y, b.y, -b.x * s.y + b.z * c.y);
      }
      void main() {
        vec3 p = turn(position);
        float perspective = 5.0 / (5.0 - p.z);
        gl_Position = vec4(p.x * layout.z * perspective * 2.0 / layout.x, -(p.y * layout.z * perspective + layout.w) * 2.0 / layout.y, -p.z * .35, 1.0);
        vNormal = turn(normal);
        vPosition = p;
        vUv = uv;
      }
    `;
    const fragmentSource = `
      precision highp float;
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec2 vUv;
      vec2 hash(vec2 p) {
        p = mod(p, vec2(105.0, 12.0));
        return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
      }
      float engraving(vec2 uv) {
        vec2 p = uv * vec2(105.0, 12.0);
        p += vec2(sin(p.y * 3.0), cos(p.x * 2.0)) * .08;
        vec2 cell = floor(p);
        vec2 local = fract(p);
        float first = 8.0;
        float second = 8.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y));
            vec2 delta = offset + .15 + hash(cell + offset) * .7 - local;
            float distance = mix(length(delta), abs(delta.x) + abs(delta.y), .4);
            if (distance < first) {
              second = first;
              first = distance;
            } else if (distance < second) {
              second = distance;
            }
          }
        }
        float line = 1.0 - smoothstep(.015, .065, second - first);
        float nested = (1.0 - smoothstep(.012, .035, abs(first - .18))) * step(.68, hash(cell).x);
        return max(line, nested * .75);
      }
      void main() {
        vec3 n = normalize(vNormal);
        vec3 view = normalize(vec3(0.0, 0.0, 5.0) - vPosition);
        vec3 light = normalize(vec3(-.65, -.85, 1.2));
        float diffuse = max(0.0, dot(n, light));
        float facing = max(0.0, dot(n, view));
        vec3 halfVector = normalize(light + view);
        float specular = pow(max(0.0, dot(n, halfVector)), 65.0);
        vec3 reflection = reflect(-view, n);
        float strip = exp(-pow((reflection.y + .45) * 5.0, 2.0)) * smoothstep(-.4, .6, reflection.z);
        float edge = pow(1.0 - facing, 2.5);
        vec3 color = mix(vec3(.012, .042, .105), vec3(.12, .48, .68), pow(diffuse, 1.35));
        color += vec3(.10, .28, .38) * strip;
        color += vec3(.035, .14, .23) * edge;
        float etch = engraving(vUv);
        color *= 1.0 - etch * .62;
        color += vec3(.018, .055, .08) * etch * diffuse;
        color += vec3(.75, .94, 1.0) * specular * 1.25;
        color += vec3(.025, .08, .12) * pow(max(0.0, dot(n, normalize(vec3(.8, .3, .4)))), 6.0);
        color = pow(color, vec3(.83));
        gl_FragColor = vec4(color, 1.0);
      }
    `;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    const data = [];
    for (let i = 0; i < sections; i++) {
      for (let j = 0; j < sides; j++) {
        const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j], [i + 1, j + 1], [i, j + 1]];
        for (const [u, v] of corners) {
          const vertex = vertices[(u % sections) * sides + v % sides];
          data.push(vertex.x, vertex.y, vertex.z, vertex.normal.x, vertex.normal.y, vertex.normal.z, u / sections, v / sides);
        }
      }
    }
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.useProgram(program);
    for (const [name, size, offset] of [['position', 3, 0], ['normal', 3, 12], ['uv', 2, 24]]) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
    }
    const rotation = gl.getUniformLocation(program, 'rotation');
    const layout = gl.getUniformLocation(program, 'layout');
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    return (rx, ry, rz) => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniform3f(rotation, rx, ry, rz);
      gl.uniform4f(layout, width, height, Math.min(width * .29, height * .305) * (1 + impulse * .025), Math.sin(elapsed * .7) * 5);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 8);
    };
  }

  metalRenderer = createMetalRenderer();
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    metalRenderer = null;
    document.body.classList.remove('canvas-ready');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    metalRenderer = createMetalRenderer();
    if (metalRenderer) document.body.classList.add('canvas-ready');
    renderMedusa();
  });

  const stars = Array.from({ length: 115 }, (_, i) => {
    const rand = seed => {
      const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return n - Math.floor(n);
    };
    return { x: rand(i + 1), y: rand(i + 99), radius: .3 + rand(i + 34) * .65, phase: rand(i + 23) * Math.PI * 2, depth: .3 + rand(i + 54) * .7 };
  });

  function measureSky() {
    skyWidth = window.innerWidth;
    skyHeight = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    space.width = Math.round(skyWidth * dpr);
    space.height = Math.round(skyHeight * dpr);
    if (sky) sky.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function renderSky() {
    if (!sky) return;
    sky.clearRect(0, 0, skyWidth, skyHeight);
    const count = skyWidth < 600 ? 55 : stars.length;
    for (let i = 0; i < count; i++) {
      const star = stars[i];
      const opacity = .18 + (Math.sin(elapsed * .45 + star.phase) + 1) * .17;
      sky.fillStyle = `rgba(171,192,216,${opacity})`;
      sky.beginPath();
      const x = ((star.x * skyWidth + elapsed * (1.2 + star.depth * 2.2) + tiltX * star.depth * 12) % (skyWidth + 16)) - 8;
      const y = ((star.y * skyHeight + elapsed * (.5 + star.depth * 1.1) + tiltY * star.depth * 12) % (skyHeight + 16)) - 8;
      sky.arc(x, y, star.radius, 0, Math.PI * 2);
      sky.fill();
    }
  }

  function renderMedusa() {

    const rx = .42 + Math.sin(elapsed * .2) * .1 + tiltY;
    const ry = -.24 + Math.sin(elapsed * .16) * .28 + tiltX;
    const rz = .78 + elapsed * .07;
    if (metalRenderer) {
      metalRenderer(rx, ry, rz);
      return;
    }
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const sx = Math.sin(rx), cx = Math.cos(rx);
    const sy = Math.sin(ry), cy = Math.cos(ry);
    const sz = Math.sin(rz), cz = Math.cos(rz);
    const rotate = p => {
      const x = p.x * cz - p.y * sz;
      const y = p.x * sz + p.y * cz;
      const yy = y * cx - p.z * sx;
      const z = y * sx + p.z * cx;
      return { x: x * cy + z * sy, y: yy, z: -x * sy + z * cy };
    };
    const scale = Math.min(width * .29, height * .32) * (1 + impulse * .025);
    const bob = Math.sin(elapsed * .7) * 5;
    const projected = vertices.map(vertex => {
      const p = rotate(vertex);
      const perspective = 5 / (5 - p.z);
      return { x: width / 2 + p.x * scale * perspective, y: height / 2 + p.y * scale * perspective + bob, z: p.z };
    });
    const visible = [];
    for (const face of faces) {
      const n = rotate(face.normal);
      if (n.z < -.1) continue;
      const points = face.indices.map(index => projected[index]);
      visible.push({ points, n, depth: points.reduce((sum, p) => sum + p.z, 0) / 4, etch: face.etch });
    }
    visible.sort((a, b) => a.depth - b.depth);
    ctx.lineWidth = .55;
    ctx.lineJoin = 'round';
    for (const face of visible) {
      const n = face.n;
      const diffuse = Math.max(0, n.x * -.4 + n.y * -.65 + n.z * .64);
      const specular = Math.pow(Math.max(0, n.x * -.22 + n.y * -.43 + n.z * .875), 24);
      const reflected = Math.exp(-Math.pow((n.y - .24) * 8, 2)) * 62;
      const rim = Math.pow(1 - Math.max(0, n.z), 3) * 44;
      let value = 35 + diffuse * 110 + specular * 120 + reflected + rim;
      if (face.etch) value = value * .8 + 3;
      const red = Math.min(246, Math.round(value * .35));
      const green = Math.min(249, Math.round(value * .74 + 8));
      const blue = Math.min(255, Math.round(value * 1.16 + 18));
      ctx.fillStyle = ctx.strokeStyle = `rgb(${red},${green},${blue})`;
      ctx.beginPath();
      face.points.forEach((p, index) => index === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  function measure() {
    const rect = sculpture.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    letters.forEach(letter => { letter.style.transform = ''; });
    bounds = letters.map(letter => letter.getBoundingClientRect());
    measureSky();
    renderMedusa();
    renderSky();
  }

  function animate(time) {
    frame = 0;
    if (paused || document.hidden) return;
    const dt = lastTime ? Math.min((time - lastTime) / 1000, .033) : 1 / 60;
    lastTime = time;
    elapsed += dt;
    const lerp = 1 - Math.exp(-dt * 5);
    tiltX += (pointer.nx * .25 - tiltX) * lerp;
    tiltY += (pointer.ny * .2 - tiltY) * lerp;
    impulse *= Math.exp(-dt * 3);
    renderMedusa();
    renderSky();

    spring.forEach((state, index) => {
      const rect = bounds[index];
      if (!rect) return;
      const distanceX = pointer.x - (rect.left + rect.width / 2);
      const distanceY = pointer.y - (rect.top + rect.height / 2);
      const distance = Math.hypot(distanceX, distanceY * 1.3);
      const reach = Math.min(150, window.innerWidth * .17);
      const influence = Math.max(0, 1 - distance / reach);
      const target = -influence * Math.min(22, rect.height * .16);
      state.velocity += ((target - state.y) * 160 - state.velocity * 15) * dt;
      state.y += state.velocity * dt;
      state.rotation += (influence * distanceX * .035 - state.rotation) * lerp * 2;
      letters[index].style.transform = `translateY(${state.y.toFixed(2)}px) rotate(${state.rotation.toFixed(2)}deg)`;
    });

    magnet.x += (magnet.targetX - magnet.x) * lerp * 2;
    magnet.y += (magnet.targetY - magnet.y) * lerp * 2;
    link.style.transform = `translate(${magnet.x.toFixed(2)}px, ${magnet.y.toFixed(2)}px)`;
    frame = requestAnimationFrame(animate);
  }

  function start() {
    if (!frame && !paused && !document.hidden) {
      lastTime = 0;
      frame = requestAnimationFrame(animate);
    }
  }

  function syncMotion() {
    if (paused) {
      cancelAnimationFrame(frame);
      frame = 0;
      spring.forEach(state => { state.y = state.velocity = state.rotation = 0; });
      letters.forEach(letter => { letter.style.transform = ''; });
      magnet.x = magnet.y = magnet.targetX = magnet.targetY = 0;
      link.style.transform = '';
    } else start();
  }

  window.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.nx = (event.clientX / window.innerWidth - .5) * 2;
    pointer.ny = (event.clientY / window.innerHeight - .5) * 2;
  }, { passive: true });

  document.documentElement.addEventListener('pointerleave', () => {
    pointer.x = pointer.y = -1000;
    pointer.nx = pointer.ny = 0;
  });

  linkWrap.addEventListener('pointermove', event => {
    if (paused || event.pointerType === 'touch') return;
    const rect = linkWrap.getBoundingClientRect();
    magnet.targetX = (event.clientX - rect.left - rect.width / 2) * .12;
    magnet.targetY = (event.clientY - rect.top - rect.height / 2) * .16;
  });
  linkWrap.addEventListener('pointerleave', () => { magnet.targetX = magnet.targetY = 0; });

  sculpture.addEventListener('pointerdown', event => {
    if (paused) return;
    impulse = 1.8;
    pointer.nx = (event.clientX / window.innerWidth - .5) * 2;
    pointer.ny = (event.clientY / window.innerHeight - .5) * 2;
  });
  motionPreference.addEventListener('change', event => { paused = event.matches; syncMotion(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else start();
  });
  window.addEventListener('resize', measure);
  if (document.fonts) document.fonts.ready.then(measure);

  measure();
  if (ctx || metalRenderer) document.body.classList.add('canvas-ready');
  syncMotion();
})();
