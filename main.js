import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'https://unpkg.com/three@0.160.0/examples/jsm/libs/meshopt_decoder.module.js';

/* ================= 基础 ================= */
const canvas = document.getElementById('three');

/* ================= Three.js 初始化 ================= */
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x1a0000, 6, 12);

// 检测移动端
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth <= 768;
const baseFOV = isMobile ? 55 : 45;  // 移动端视野更广
const baseCameraY = isMobile ? 2.6 : 2.4;
const baseCameraZ = isMobile ? 7 : 6;

const camera = new THREE.PerspectiveCamera(baseFOV, canvas.clientWidth / canvas.clientHeight, 0.1, 50);
camera.position.set(0, baseCameraY, baseCameraZ);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(canvas.clientWidth, canvas.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMappingExposure = 1.2;

function updateCameraForViewport() {
  const isMobileNow = window.innerWidth <= 768;
  const fov = isMobileNow ? 55 : 45;
  const camY = isMobileNow ? 2.6 : 2.4;
  const camZ = isMobileNow ? 7 : 6;
  
  camera.fov = fov;
  camera.position.y = camY;
  camera.position.z = camZ;
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
}

window.addEventListener('resize', updateCameraForViewport);
updateCameraForViewport();  // 初始化时调用一次

/* ================= 灯光 ================= */
scene.add(new THREE.AmbientLight(0xffffff, 0.7));

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemi.position.set(0, 4, 0);
scene.add(hemi);

const spot = new THREE.SpotLight(0xffffff, 3, 24, Math.PI / 5, 0.4, 1);
spot.position.set(0, 6, 3);
spot.target.position.set(0, 1.6, 0);
scene.add(spot);
scene.add(spot.target);

const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(-4, 2, 4);
scene.add(fill);

/* ================= 舞台地面 ================= */
const stage = new THREE.Mesh(
  new THREE.CircleGeometry(3, 32),
  new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 })
);
stage.rotation.x = -Math.PI / 2;
scene.add(stage);

/* ================= 人物（GLB 模型容器） ================= */
const person = new THREE.Group();
scene.add(person);

// 骨骼动画：受击随机动作 + 跳舞循环
let modelRoot = null;
let mixer = null;
let hitClips = [];
let danceClips = [];
let currentHitAction = null;
let currentDanceAction = null;
let lastHitClipName = '';
let hitRig = null; // 无动画时的“程序受击骨骼”
let danceRig = null; // 程序化跳舞骨骼系统
let danceTime = 0; // 跳舞时间计数器
let isDancing = true; // 是否正在跳舞

// 胸前木板（文字牌）
let signMesh = null;
let signCanvas = null;
let signCtx = null;
let signTex = null;
let currentSignText = '你好';

/* ================= 语音喷他（移动端优先） ================= */
const voiceBall = document.getElementById('voiceBall');
const voiceModal = document.getElementById('voiceModal');
const voiceInput = document.getElementById('voiceInput');
const voiceSend = document.getElementById('voiceSend');
const voiceCancel = document.getElementById('voiceCancel');
let isVoiceRecording = false;
let speechRecognizer = null;
let mediaStream = null;
let mediaRecorder = null;
let mediaChunks = [];
let usedWebSpeech = false;

// 语音音量检测
let audioContext = null;
let analyserNode = null;
let micSourceNode = null;
let volumeData = null;
let currentLoudness = 0;
let peakLoudness = 0;
let pendingVoiceAmp = 1;

// “脸部中心”目标（人物局部坐标）
let faceTargetLocal = new THREE.Vector3(0, 1.7, 0.35);

// 语音临时气泡（录音中实时更新）
let liveVoiceSprite = null;
let liveVoiceText = '';

// 飞行中的气泡 + 碎裂碎片
const flyingTexts = [];
const shards = [];

// 人物身上的蛋液效果
const yolkStains = [];

// 受击后的回复气泡
const hitReplyBubbles = [];
const hitReplyTexts = [
  '错了错了！',
  '别打了！',
  '有话好好说！',
  '我知道错了还不行吗？',
  '轻点轻点！',
  '哎哟～',
  '饶命啊大哥！',
  '我再也不敢了！',
  '冷静冷静……',
  '嘴下留情！',
  '打脸就过分了！'
];

// 冲走后的“从天而降”口号
const flushSlogans = [
  '冲走了，压力也走了。',
  '好了，先把烦恼冲下去。',
  '呼——这一波，算你赢。',
  '别急，先把心情清空一下。',
  '今天就到这儿，明天再说。',
  '已冲走：烦恼.exe',
  '压力：已清空（回收站）。',
  '冲走成功！请勿回收。',
  '已完成：情绪卸载 100%。',
  '冲走了！谁都别拦我快乐！',
  '冲走的是压力，不是你。',
  '把糟心事冲走，把自己留下。',
  '讨厌的事：拜拜了您嘞。',
  '不爽归不爽，先冲掉再讲。',
  '世界很吵，先让它安静一秒。',
  '冲走了。\n你也该轻一点了。',
  '压力下去了。\n你还在。',
  '这一坨烦恼没了。\n下一口气更顺。'
];
const sloganDrops = [];

loadPersonModel();
setupSignUI();
setupVoiceSpray();

function loadPersonModel() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(
    'assets/model.glb',
    (gltf) => {
      // 清空旧人物（如果有）
      for (let i = person.children.length - 1; i >= 0; i--) person.remove(person.children[i]);
      mixer = null;
      modelRoot = null;
      hitClips = [];
      danceClips = [];
      currentHitAction = null;
      currentDanceAction = null;
      lastHitClipName = '';
      hitRig = null;
      danceRig = null;
      isDancing = true;
      danceTime = 0;

      const model = gltf.scene || gltf.scenes?.[0];
      if (!model) return;
      modelRoot = model;

      // 让模型更“舞台友好”：开启阴影、统一色彩空间
      model.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.castShadow = true;
        obj.receiveShadow = true;
      });

      person.add(model);

      // 初始化骨骼动画（如果 glb 内带动画）
      if (Array.isArray(gltf.animations) && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        const clips = gltf.animations.slice();
        
        // 分离跳舞动画和受击动画
        const byHit = clips.filter(c => /hit|hurt|impact|damage|react|stun|knock/i.test(c.name));
        const byDance = clips.filter(c => /dance|dancing|idle|stand|breath|loop|walk|run/i.test(c.name));
        
        // 受击动画：优先 hit 类，否则用非 idle 类
        const nonIdle = clips.filter(c => !/idle|stand|breath|loop|dance|walk|run/i.test(c.name));
        hitClips = (byHit.length ? byHit : (nonIdle.length ? nonIdle : clips));
        
        // 跳舞动画：优先 dance，否则用 idle/stand/loop
        danceClips = byDance.length > 0 ? byDance : clips.filter(c => /idle|stand|breath|loop/i.test(c.name));
        
        // 如果没有明确的跳舞动画，就用第一个动画作为默认
        if (danceClips.length === 0 && clips.length > 0) {
          danceClips = [clips[0]];
        }
        
        // 开始播放跳舞动画（循环）
        if (danceClips.length > 0) {
          startDanceAnimation();
        }
      }
      // 没有动画也没关系：初始化“程序受击骨骼”和“程序跳舞骨骼”
      hitRig = buildHitRig(model);
      danceRig = buildDanceRig(model);
      isDancing = true;
      danceTime = 0;

      // 自动居中并落地（把模型底部放到 y=0）
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      model.position.sub(center); // 先把中心挪到原点
      // 让脚踩地：把最低点移到 y=0
      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y -= box2.min.y;

      // 根据高度自动缩放到合适大小（头顶约 1.5m，可根据需要调整）
      const targetHeight = 1.2;  // 从2.2改为1.5，让模型更小
      const h = Math.max(size.y, 0.0001);
      const s = targetHeight / h;
      model.scale.setScalar(s);

      // 缩放后再落地一次，避免浮空
      const box3 = new THREE.Box3().setFromObject(model);
      model.position.y -= box3.min.y;

      // 创建/重建胸前木板（挂在 person 上，跟着冲走/旋转一起动）
      createOrUpdateSignMesh(model);
      renderSignText(currentSignText);

      // 更新“脸部中心”目标：基于包围盒估算
      const faceBox = new THREE.Box3().setFromObject(model);
      const faceSize = faceBox.getSize(new THREE.Vector3());
      const faceCenter = faceBox.getCenter(new THREE.Vector3());
      const faceWorld = new THREE.Vector3(
        faceCenter.x,
        faceBox.min.y + faceSize.y * 0.78,
        faceBox.max.z + Math.max(0.06, faceSize.z * 0.04)
      );
      faceTargetLocal = person.worldToLocal(faceWorld.clone());
    },
    undefined,
    (err) => {
      console.error('加载 GLB 失败：', err);
    }
  );
}

function setupSignUI() {
  const signText = document.getElementById('signText');
  const signBtn = document.getElementById('signBtn');
  if (!signText || !signBtn) return;

  // 初始值
  signText.value = currentSignText;

  const commit = () => {
    currentSignText = (signText.value || '').trim().slice(0, 20) || '...';
    renderSignText(currentSignText);
  };

  signBtn.addEventListener('click', commit);
  signText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
  });
}

function setupVoiceSpray() {
  if (!voiceBall) return;
  voiceBall.addEventListener('click', toggleVoiceRecording);

  if (voiceSend && voiceCancel && voiceModal && voiceInput) {
    voiceSend.addEventListener('click', () => {
      const txt = (voiceInput.value || '').trim();
      const content = txt || '（气到说不出话）';
      shootVoiceText(content, pendingVoiceAmp || 1);
      closeVoiceModal();
    });
    voiceCancel.addEventListener('click', () => {
      // 取消时也可以给一个轻微文字，不那么空
      if (!voiceInput.value.trim()) {
        shootVoiceText('……', Math.max(pendingVoiceAmp * 0.8, 0.7));
      }
      closeVoiceModal();
    });
  }
}

async function toggleVoiceRecording() {
  if (isVoiceRecording) {
    stopVoiceRecording();
  } else {
    await startVoiceRecording();
  }
}

function hasWebSpeech() {
  return typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
}

async function startVoiceRecording() {
  if (isVoiceRecording) return;
  isVoiceRecording = true;
  voiceBall?.classList?.add('recording');

  currentLoudness = 0;
  peakLoudness = 0;

  liveVoiceText = '...';
  ensureLiveVoiceSprite();
  updateLiveVoiceSprite(liveVoiceText);

  if (hasWebSpeech()) {
    try {
      usedWebSpeech = true;
      await ensureVolumeMonitor();
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      speechRecognizer = new SR();
      speechRecognizer.lang = 'zh-CN';
      speechRecognizer.continuous = true;
      speechRecognizer.interimResults = true;

      speechRecognizer.onresult = (event) => {
        let interim = '';
        let fin = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const txt = res[0]?.transcript || '';
          if (res.isFinal) fin += txt;
          else interim += txt;
        }
        const next = (fin || interim || '').trim();
        if (next) {
          liveVoiceText = next;
          updateLiveVoiceSprite(liveVoiceText);
        }
      };

      speechRecognizer.onerror = () => {
        // 出错也允许用户结束，最终会走占位文本
      };

      speechRecognizer.onend = () => {
        // 部分浏览器会自动停止；如果我们还处于录音态，就保持 UI，不自动发射
      };

      speechRecognizer.start();
      return;
    } catch (e) {
      // Web Speech 初始化失败 → 走 MediaRecorder 降级
    }
  }

  // iOS Safari 等：降级录音（不做实时识别）
  try {
    usedWebSpeech = false;
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaChunks = [];
    await ensureVolumeMonitor(mediaStream);

    if (typeof MediaRecorder === 'undefined') {
      // 彻底不支持录音
      liveVoiceText = '（未支持实时语音）';
      updateLiveVoiceSprite(liveVoiceText);
      return;
    }

    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) mediaChunks.push(e.data);
    };
    mediaRecorder.start();
  } catch (e) {
    liveVoiceText = '（麦克风权限被拒绝）';
    updateLiveVoiceSprite(liveVoiceText);
  }
}

function stopVoiceRecording() {
  if (!isVoiceRecording) return;
  isVoiceRecording = false;
  voiceBall?.classList?.remove('recording');

  // 先停 Web Speech
  if (speechRecognizer) {
    try { speechRecognizer.stop(); } catch {}
    speechRecognizer = null;
  }

  // 再停录音
  if (mediaRecorder) {
    try { mediaRecorder.stop(); } catch {}
    mediaRecorder = null;
  }

  if (mediaStream) {
    try { mediaStream.getTracks().forEach(t => t.stop()); } catch {}
    mediaStream = null;
  }

  const finalText = (liveVoiceText || '').trim() || '...';

  // 把音量粗略映射到 [0.7, 2.3] 的放大系数
  const vol = Math.max(peakLoudness, currentLoudness, 0.02);
  const norm = clamp(vol / 0.35, 0, 2);
  const amp = clamp(0.7 + norm * 1.6, 0.7, 2.3);
  pendingVoiceAmp = amp;

  if (usedWebSpeech) {
    // 桌面浏览器 / 支持 Web Speech：直接用识别的中文发射
    shootVoiceText(finalText, amp);
  } else if (voiceModal && voiceInput && voiceSend) {
    // 移动端 / 不支持实时语音：弹出输入弹窗，请用户打字
    openVoiceModal(finalText);
  } else {
    // 兜底：仍然给一条占位提示
    shootVoiceText('（未支持实时语音，请改用更高版本浏览器或接入后端识别）', amp);
  }

  // 清理录音中的临时气泡
  if (liveVoiceSprite) {
    scene.remove(liveVoiceSprite);
    disposeSprite(liveVoiceSprite);
    liveVoiceSprite = null;
  }
  liveVoiceText = '';
}

function ensureLiveVoiceSprite() {
  if (liveVoiceSprite) return;
  liveVoiceSprite = createTextBubbleSprite('...', {
    fontSize: 44,
    padding: 46,
    maxWidth: 420,
  });
  liveVoiceSprite.scale.set(1.2, 1.0, 1);
  scene.add(liveVoiceSprite);
}

function updateLiveVoiceSprite(text) {
  if (!liveVoiceSprite) return;
  updateTextBubbleSprite(liveVoiceSprite, text, {
    fontSize: 44,
    padding: 46,
    maxWidth: 420,
  });
}

function shootVoiceText(text, amp = 1) {
  const start = getVoiceBallWorldPoint(3.0);
  const target = person.localToWorld(faceTargetLocal.clone());
  const control = start.clone().lerp(target, 0.5);
  control.y += 1.0;

  const baseFont = 56;
  const sp = createTextBubbleSprite(text, { fontSize: baseFont * amp, padding: 52, maxWidth: 460 * amp });
  sp.position.copy(start);
  // 初始 scale，也叠加音量系数
  sp.scale.setScalar(0.25 * amp);
  scene.add(sp);

  const baseDuration = 0.85;
  const duration = baseDuration / clamp(amp, 0.7, 2.3); // 越响飞得越快

  flyingTexts.push({
    sprite: sp,
    start,
    control,
    target,
    t: 0,
    duration,
    amp,
  });
}

function getVoiceBallWorldPoint(distance = 3.0) {
  const canvasRect = canvas.getBoundingClientRect();
  const btnRect = voiceBall.getBoundingClientRect();
  const cx = btnRect.left + btnRect.width / 2;
  const cy = btnRect.top + btnRect.height / 2;

  const x = (cx - canvasRect.left) / canvasRect.width;
  const y = (cy - canvasRect.top) / canvasRect.height;

  const ndc = new THREE.Vector3(x * 2 - 1, -(y * 2 - 1), 0.5);
  const p = ndc.clone().unproject(camera);
  const dir = p.sub(camera.position).normalize();
  return camera.position.clone().add(dir.multiplyScalar(distance));
}

function createTextBubbleSprite(text, opts) {
  const { canvas: c, ctx, tex } = drawBubbleToTexture(text, opts);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.userData._bubble = { canvas: c, ctx, tex, opts, text };
  return sp;
}

function updateTextBubbleSprite(sprite, text, opts) {
  const d = sprite.userData._bubble;
  if (!d) return;
  d.opts = opts || d.opts;
  d.text = text;
  drawBubbleIntoExisting(d.canvas, d.ctx, d.tex, text, d.opts);
}

async function ensureVolumeMonitor(streamOverride) {
  if (analyserNode && volumeData) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    audioContext = audioContext || new AudioCtx();
    const stream = streamOverride || mediaStream || await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!stream) return;

    micSourceNode = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 512;
    micSourceNode.connect(analyserNode);
    volumeData = new Uint8Array(analyserNode.fftSize);
  } catch (e) {
    // 静默失败：没有音量检测时退回默认动画强度
  }
}

function openVoiceModal(defaultText) {
  if (!voiceModal || !voiceInput) return;
  voiceInput.value = (defaultText || '').trim();
  voiceModal.hidden = false;
  // 简单聚焦，移动端可能会触发软键盘
  setTimeout(() => {
    try { voiceInput.focus(); } catch {}
  }, 50);
}

function closeVoiceModal() {
  if (!voiceModal || !voiceInput) return;
  voiceModal.hidden = true;
  voiceInput.value = '';
}

function drawBubbleToTexture(text, opts = {}) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  drawBubbleIntoExisting(c, ctx, tex, text, opts);
  return { canvas: c, ctx, tex };
}

function drawBubbleIntoExisting(c, ctx, tex, text, opts = {}) {
  const fontSize = opts.fontSize ?? 56;
  const padding = opts.padding ?? 56;
  const maxWidth = opts.maxWidth ?? 420;

  ctx.clearRect(0, 0, c.width, c.height);

  // 气泡底
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 14;
  const r = 56;
  const w = maxWidth;
  const h = 220;
  const x = (c.width - w) / 2;
  const y = 90;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 尖角
  ctx.beginPath();
  ctx.moveTo(c.width / 2 - 40, y + h);
  ctx.lineTo(c.width / 2, y + h + 80);
  ctx.lineTo(c.width / 2 + 40, y + h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 文字
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  let fs = fontSize;
  const lines = wrapTextForCanvas(ctx, text, maxWidth - padding * 2, 2, fs);
  while (fs > 28) {
    ctx.font = `900 ${fs}px system-ui`;
    const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
    if (widest <= (maxWidth - padding * 2)) break;
    fs -= 4;
  }
  ctx.font = `900 ${fs}px system-ui`;
  const lineGap = fs * 1.15;
  const startY = y + h / 2 - ((lines.length - 1) * lineGap) / 2;
  lines.forEach((l, i) => ctx.fillText(l, c.width / 2, startY + i * lineGap));

  tex.needsUpdate = true;
}

function wrapTextForCanvas(ctx, text, maxW, maxLines, fontSize) {
  const t = (text || '').trim() || '...';
  ctx.font = `900 ${fontSize}px system-ui`;
  if (ctx.measureText(t).width <= maxW) return [t];
  if (maxLines <= 1) return [t];
  // 简单二行：尽量均分字符（中文效果较好）
  const mid = Math.ceil(t.length / 2);
  return [t.slice(0, mid), t.slice(mid)];
}

function startDanceAnimation() {
  if (!mixer || !danceClips || danceClips.length === 0) return;
  
  // 随机选一个跳舞动画（如果有多个）
  const danceClip = danceClips[Math.floor(Math.random() * danceClips.length)];
  if (!danceClip) return;
  
  const danceAction = mixer.clipAction(danceClip);
  danceAction.reset();
  danceAction.setLoop(THREE.LoopRepeat, Infinity);  // 无限循环
  danceAction.enabled = true;
  danceAction.timeScale = 1;
  danceAction.fadeIn(0.3).play();
  
  currentDanceAction = danceAction;
}

function playRandomHitReaction() {
  if (!mixer || !hitClips || hitClips.length === 0) return;

  // 暂停跳舞动画（如果有）
  if (currentDanceAction) {
    currentDanceAction.fadeOut(0.1);
  }
  // 暂停程序化跳舞
  isDancing = false;

  // 尽量不重复同一个
  let clip = hitClips[Math.floor(Math.random() * hitClips.length)];
  if (hitClips.length > 1 && clip?.name === lastHitClipName) {
    clip = hitClips[(hitClips.indexOf(clip) + 1) % hitClips.length];
  }
  if (!clip) return;
  lastHitClipName = clip.name;

  const next = mixer.clipAction(clip);
  next.reset();
  next.setLoop(THREE.LoopOnce, 1);
  next.clampWhenFinished = true;
  next.enabled = true;
  next.timeScale = 1;

  // 停掉上一个受击动作，避免叠在一起
  if (currentHitAction && currentHitAction !== next) {
    currentHitAction.fadeOut(0.08);
  }
  currentHitAction = next;
  next.fadeIn(0.06).play();
}

function buildHitRig(model) {
  // 找到任意一套 skeleton（skinned mesh）
  const skeletons = [];
  model.traverse((obj) => {
    if (obj && obj.isSkinnedMesh && obj.skeleton) skeletons.push(obj.skeleton);
  });
  const skeleton = skeletons[0];
  if (!skeleton || !Array.isArray(skeleton.bones) || skeleton.bones.length === 0) return null;

  const bones = skeleton.bones;
  const pickByName = (re) => bones.filter(b => typeof b.name === 'string' && re.test(b.name));

  const spine = pickByName(/spine|chest|upperchest|torso/i);
  const neck = pickByName(/neck/i);
  const head = pickByName(/head/i);
  const clavicle = pickByName(/clavicle|collar|shoulder/i);
  const upperArm = pickByName(/upperarm|uparm|arm\.?l|arm\.?r|arm_l|arm_r|leftarm|rightarm/i);
  const lowerArm = pickByName(/lowerarm|forearm|loarm|elbow/i);
  const hand = pickByName(/hand|wrist/i);

  // 优先上半身骨骼；否则兜底取靠后的几根（跳过 root）
  let candidates = [...spine, ...neck, ...head, ...clavicle, ...upperArm, ...lowerArm, ...hand];
  if (candidates.length === 0) candidates = bones.slice(1, Math.min(6, bones.length));

  // 去重
  candidates = Array.from(new Set(candidates));

  // 记录初始姿态
  const base = new Map();
  const state = new Map();
  candidates.forEach((b) => {
    base.set(b.uuid, b.quaternion.clone());
    state.set(b.uuid, {
      // 角速度（欧拉近似）
      v: new THREE.Vector3(0, 0, 0),
      // 当前偏移（欧拉近似）
      o: new THREE.Vector3(0, 0, 0),
      // 每根骨骼的轴向权重：避免手往下甩穿模
      axisW: (() => {
        const name = (b.name || '').toLowerCase();
        const isArm = /clavicle|collar|shoulder|arm|forearm|hand|wrist|elbow/.test(name);
        // x: 前后俯仰（最容易让手往下穿模）→ 手臂上显著降低
        // y/z: 左右摆动/扭转 → 保持/略增强
        return isArm
          ? new THREE.Vector3(0.25, 1.15, 1.1)
          : new THREE.Vector3(1.0, 1.0, 1.0);
      })(),
    });
  });

  return { skeleton, candidates, base, state, ttl: 0 };
}

function buildDanceRig(model) {
  // 复用 buildHitRig 的逻辑找到骨骼
  const skeletons = [];
  model.traverse((obj) => {
    if (obj && obj.isSkinnedMesh && obj.skeleton) skeletons.push(obj.skeleton);
  });
  const skeleton = skeletons[0];
  if (!skeleton || !Array.isArray(skeleton.bones) || skeleton.bones.length === 0) return null;

  const bones = skeleton.bones;
  const pickByName = (re) => bones.filter(b => typeof b.name === 'string' && re.test(b.name));

  const spine = pickByName(/spine|chest|upperchest|torso/i);
  const neck = pickByName(/neck/i);
  const head = pickByName(/head/i);
  const clavicle = pickByName(/clavicle|collar|shoulder/i);
  const upperArm = pickByName(/upperarm|uparm|arm\.?l|arm\.?r|arm_l|arm_r|leftarm|rightarm/i);
  const lowerArm = pickByName(/lowerarm|forearm|loarm|elbow/i);
  const hand = pickByName(/hand|wrist/i);

  let candidates = [...spine, ...neck, ...head, ...clavicle, ...upperArm, ...lowerArm, ...hand];
  if (candidates.length === 0) candidates = bones.slice(1, Math.min(8, bones.length));
  candidates = Array.from(new Set(candidates));

  // 记录初始姿态和跳舞参数
  const base = new Map();
  const danceParams = new Map();
  candidates.forEach((b, idx) => {
    base.set(b.uuid, b.quaternion.clone());
    const name = (b.name || '').toLowerCase();
    const isArm = /clavicle|collar|shoulder|arm|forearm|hand|wrist|elbow/.test(name);
    const isHead = /head/i.test(name);
    const isSpine = /spine|chest|upperchest|torso/i.test(name);
    
    danceParams.set(b.uuid, {
      isArm,
      isHead,
      isSpine,
      phase: (idx / Math.max(candidates.length, 1)) * Math.PI * 2, // 相位偏移，让不同骨骼不同步
      amplitude: isArm ? 0.25 : (isHead ? 0.15 : (isSpine ? 0.2 : 0.12)), // 摆动幅度
      speed: isArm ? 1.8 : (isHead ? 1.2 : 1.5), // 摆动速度
    });
  });

  return { skeleton, candidates, base, danceParams };
}

function updateProceduralDance(dt) {
  if (!danceRig || !isDancing) return;
  
  danceTime += dt;
  
  danceRig.candidates.forEach((b) => {
    const baseQ = danceRig.base.get(b.uuid);
    const params = danceRig.danceParams.get(b.uuid);
    if (!baseQ || !params) return;

    const t = danceTime * params.speed + params.phase;
    let offsetX = 0, offsetY = 0, offsetZ = 0;

    if (params.isSpine) {
      // 身体：左右摇摆 + 轻微前后
      offsetY = Math.sin(t) * params.amplitude * 0.8;
      offsetX = Math.sin(t * 0.7) * params.amplitude * 0.3;
      offsetZ = Math.cos(t * 0.5) * params.amplitude * 0.2;
    } else if (params.isHead) {
      // 头部：跟随身体，但幅度更小
      offsetY = Math.sin(t * 0.9) * params.amplitude * 0.6;
      offsetX = Math.sin(t * 0.6) * params.amplitude * 0.2;
    } else if (params.isArm) {
      // 手臂：上下摆动 + 左右展开
      const armPhase = params.phase;
      const isLeft = /left|l\.|_l/i.test(b.name);
      const side = isLeft ? -1 : 1;
      
      // 上下摆动（主要动作）
      offsetX = Math.sin(t + armPhase) * params.amplitude * 1.2;
      // 左右展开/收回
      offsetY = Math.cos(t * 0.8 + armPhase) * params.amplitude * side * 0.6;
      // 轻微扭转
      offsetZ = Math.sin(t * 1.1 + armPhase) * params.amplitude * 0.4;
    } else {
      // 其他骨骼：轻微跟随
      offsetY = Math.sin(t * 0.7) * params.amplitude * 0.5;
    }

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(offsetX, offsetY, offsetZ, 'XYZ'));
    b.quaternion.copy(baseQ).multiply(q);
  });
}

function triggerProceduralHit() {
  if (!hitRig || !hitRig.candidates || hitRig.candidates.length === 0) return;
  
  // 暂停程序化跳舞
  isDancing = false;
  
  // 受击持续时间
  hitRig.ttl = 0.45;

  // 给每根候选骨骼一个随机冲击（上半身更明显）
  const n = hitRig.candidates.length;
  hitRig.candidates.forEach((b, i) => {
    const st = hitRig.state.get(b.uuid);
    if (!st) return;
    // 让手臂/手更容易被带动（通常骨骼名字里含 arm/hand）
    const name = (b.name || '').toLowerCase();
    const armBoost = /clavicle|collar|shoulder|arm|forearm|hand|wrist|elbow/.test(name) ? 1.25 : 1.0;
    const w = (1 - i / Math.max(n, 1)) * armBoost;

    const isArm = /clavicle|collar|shoulder|arm|forearm|hand|wrist|elbow/.test(name);
    if (isArm) {
      // 手臂/手：尽量左右/扭转，不要往下甩（减少 x）
      const kickX = (0.10 + Math.random() * 0.12) * w;           // 很小的前后
      const kickY = (0.45 + Math.random() * 0.45) * (Math.random() < 0.5 ? -1 : 1) * w; // 左右摆
      const kickZ = (0.35 + Math.random() * 0.55) * (Math.random() < 0.5 ? -1 : 1) * w; // 扭转
      // x 方向偏后仰但幅度小
      const dir = (Math.random() < 0.8) ? 1 : -1;
      st.v.x += kickX * dir * 7.0 * st.axisW.x;
      st.v.y += kickY * 7.5 * st.axisW.y;
      st.v.z += kickZ * 7.5 * st.axisW.z;
    } else {
      // 躯干/头：仍以 x 为主
      const kickX = (0.55 + Math.random() * 0.45) * w;
      const kickY = (Math.random() - 0.5) * 0.45 * w;
      const kickZ = (Math.random() - 0.5) * 0.55 * w;
      const dir = (Math.random() < 0.8) ? 1 : -1;
      st.v.x += kickX * dir * 7.5;
      st.v.y += kickY * 7.5;
      st.v.z += kickZ * 7.5;
    }
  });
}

function updateProceduralHit(dt) {
  if (!hitRig) return;

  // 弹簧参数：大一点的回弹 + 阻尼
  const k = 38;     // 回弹强度
  const damp = 9.5; // 阻尼

  // 即使 ttl 结束，也继续让它回到 0 偏移
  hitRig.ttl = Math.max(hitRig.ttl - dt, 0);

  hitRig.candidates.forEach((b, i) => {
    const baseQ = hitRig.base.get(b.uuid);
    const st = hitRig.state.get(b.uuid);
    if (!baseQ || !st) return;

    // 越靠上（head/neck）越容易“摆动”一点
    const w = 0.75 + (1 - i / Math.max(hitRig.candidates.length, 1)) * 0.35;

    // 简单弹簧：o'' = -k*o - damp*o'
    st.v.x += (-k * st.o.x - damp * st.v.x) * dt * w * st.axisW.x;
    st.v.y += (-k * st.o.y - damp * st.v.y) * dt * w * st.axisW.y;
    st.v.z += (-k * st.o.z - damp * st.v.z) * dt * w * st.axisW.z;

    st.o.addScaledVector(st.v, dt);

    // 当没有受击且足够接近 0，就钳制到 0，避免抖动残留
    if (hitRig.ttl === 0 && st.o.lengthSq() < 1e-5 && st.v.lengthSq() < 1e-4) {
      st.o.set(0, 0, 0);
      st.v.set(0, 0, 0);
      b.quaternion.copy(baseQ);
      return;
    }

    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(st.o.x, st.o.y, st.o.z, 'XYZ'));
    b.quaternion.copy(baseQ).multiply(q);
  });
}

function spawnHitReplyBubble() {
  if (!person || !modelRoot || hitReplyTexts.length === 0) return;
  const text = hitReplyTexts[Math.floor(Math.random() * hitReplyTexts.length)];

  // 在脸附近随机一点位置
  const local = faceTargetLocal.clone().add(
    new THREE.Vector3(
      (Math.random() - 0.5) * 0.8,
      0.35 + Math.random() * 0.4,
      -0.2 + Math.random() * 0.2
    )
  );
  const world = person.localToWorld(local);

  const sp = createTextBubbleSprite(text, {
    fontSize: 40,
    padding: 40,
    maxWidth: 360,
  });
  sp.position.copy(world);
  sp.scale.set(1.8, 1.4, 1);
  sp.material.opacity = 0.0;
  scene.add(sp);

  hitReplyBubbles.push({
    sprite: sp,
    life: 1.4,
    maxLife: 1.4,
  });
}

function spawnFlushSlogan() {
  if (!flushSlogans.length) return;
  const raw = flushSlogans[Math.floor(Math.random() * flushSlogans.length)];
  const text = raw.trim();

  // 根据移动端调整文字大小
  const isMobileNow = window.innerWidth <= 768;
  const fontSize = isMobileNow ? 64 : 88;
  const padding = isMobileNow ? 50 : 70;
  const maxWidth = isMobileNow ? 520 : 720;

  // 生成大号卡通文字 Sprite
  const sp = createTextBubbleSprite(text, {
    fontSize,
    padding,
    maxWidth,
  });

  // 出生在人物头顶偏上的高空，从天而降（移动端调整位置）
  const startY = isMobileNow ? 6.5 : 7.5;
  const endY = isMobileNow ? 2.2 : 3.0;
  const start = new THREE.Vector3(0, startY, 0);
  const end = new THREE.Vector3(0, endY, 0);
  sp.position.copy(start);
  
  // 移动端缩小一点，确保完整显示
  const scaleX = isMobileNow ? 3.2 : 4.5;
  const scaleY = isMobileNow ? 2.4 : 3.4;
  sp.scale.set(scaleX, scaleY, 1);
  sp.material.opacity = 0;
  // 始终绘制在最前面，不被场景遮挡
  sp.material.depthTest = false;
  sp.material.depthWrite = false;
  sp.renderOrder = 999;
  scene.add(sp);

  sloganDrops.push({
    sprite: sp,
    start,
    end,
    t: 0,
    duration: 3.0,
    baseScaleX: scaleX,  // 保存初始缩放
    baseScaleY: scaleY,
  });
}

function disposeSprite(sprite) {
  if (!sprite) return;
  const mat = sprite.material;
  if (mat?.map) mat.map.dispose();
  mat?.dispose?.();
}
function createOrUpdateSignMesh(model) {
  // 以模型尺寸为基准，估算木板大小/位置
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());

  const boardW = Math.max(0.6, Math.min(1.2, size.x * 0.55));
  const boardH = Math.max(0.25, Math.min(0.6, size.y * 0.18));

  if (!signCanvas) {
    signCanvas = document.createElement('canvas');
    signCanvas.width = 1024;
    signCanvas.height = 512;
    signCtx = signCanvas.getContext('2d');
    signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    signTex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 1;
  }

  if (signMesh) {
    person.remove(signMesh);
    signMesh.geometry.dispose();
  }

  const woodMat = new THREE.MeshStandardMaterial({
    map: signTex,
    roughness: 0.9,
    metalness: 0.0,
  });

  signMesh = new THREE.Mesh(new THREE.PlaneGeometry(boardW, boardH), woodMat);
  // “胸前”位置：居中偏上，向前一点
  signMesh.position.set(0, Math.max(2, size.y * 0.58), Math.max(0.25, size.z * 0.35));
  signMesh.rotation.y = 0; // 默认朝向相机；如果模型面向反了，再调成 Math.PI
  signMesh.renderOrder = 2;

  person.add(signMesh);
}

function renderSignText(text) {
  if (!signCtx || !signTex) return;

  const w = signCanvas.width;
  const h = signCanvas.height;

  // 背景木纹（简易）
  signCtx.clearRect(0, 0, w, h);
  signCtx.fillStyle = '#b07a45';
  signCtx.fillRect(0, 0, w, h);
  for (let i = 0; i < 18; i++) {
    const y = (i / 18) * h;
    signCtx.fillStyle = `rgba(80, 45, 20, ${0.06 + (i % 3) * 0.02})`;
    signCtx.fillRect(0, y, w, 8);
  }
  // 边框
  signCtx.lineWidth = 26;
  signCtx.strokeStyle = 'rgba(60,30,10,0.65)';
  signCtx.strokeRect(18, 18, w - 36, h - 36);

  // 文字（自动缩放到合适大小，支持换行到最多2行）
  const paddingX = 80;
  const maxW = w - paddingX * 2;
  const lines = splitTextToLines(text, 2);

  let fontSize = 140;
  while (fontSize > 48) {
    signCtx.font = `900 ${fontSize}px system-ui`;
    const widest = Math.max(...lines.map(l => signCtx.measureText(l).width));
    if (widest <= maxW) break;
    fontSize -= 6;
  }

  signCtx.font = `900 ${fontSize}px system-ui`;
  signCtx.textAlign = 'center';
  signCtx.textBaseline = 'middle';
  signCtx.fillStyle = '#1b0f05';
  signCtx.shadowColor = 'rgba(0,0,0,0.25)';
  signCtx.shadowBlur = 8;
  signCtx.shadowOffsetY = 4;

  const lineGap = fontSize * 1.15;
  const startY = h / 2 - ((lines.length - 1) * lineGap) / 2;
  lines.forEach((l, i) => {
    signCtx.fillText(l, w / 2, startY + i * lineGap);
  });

  signTex.needsUpdate = true;
}

function splitTextToLines(text, maxLines) {
  const t = (text || '').trim();
  if (!t) return ['...'];
  // 简单策略：如果太长，切成两行（尽量均分）
  if (t.length <= 10 || maxLines <= 1) return [t];
  const mid = Math.ceil(t.length / 2);
  return [t.slice(0, mid), t.slice(mid, t.length)];
}

/* ================= 鸡蛋（3D 抛物线） ================= */
const eggs = [];

function createEggShellTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  // 基础米白色
  ctx.fillStyle = '#fff8e8';
  ctx.fillRect(0, 0, c.width, c.height);

  // 轻微渐变（顶部稍亮）
  const grad = ctx.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(240,230,210,0.2)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);

  // 随机小斑点（蛋壳纹理）
  ctx.fillStyle = 'rgba(220,200,180,0.4)';
  for (let i = 0; i < 25; i++) {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    const r = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 高光点
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  ctx.arc(c.width * 0.3, c.height * 0.25, 20, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createYolkTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  // 蛋黄中心（橙黄色）
  const centerX = c.width / 2;
  const centerY = c.height / 2;
  const radius = 80;

  const yolkGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  yolkGrad.addColorStop(0, '#ffd700');
  yolkGrad.addColorStop(0.6, '#ffb347');
  yolkGrad.addColorStop(1, '#ff8c42');
  ctx.fillStyle = yolkGrad;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();

  // 蛋白（半透明白色，边缘）
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + 15, 0, Math.PI * 2);
  ctx.fill();

  // 蛋白外层（更透明）
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + 35, 0, Math.PI * 2);
  ctx.fill();

  // 高光
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(centerX - 15, centerY - 15, 12, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createYolkStainTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  // 半透明背景（用于混合）
  ctx.clearRect(0, 0, c.width, c.height);

  // 主蛋液区域（橙黄色，不规则形状）
  const centerX = c.width / 2;
  const centerY = c.height * 0.4;
  
  // 主滴落点
  const mainGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 60);
  mainGrad.addColorStop(0, 'rgba(255,215,0,0.9)');
  mainGrad.addColorStop(0.5, 'rgba(255,179,71,0.8)');
  mainGrad.addColorStop(1, 'rgba(255,140,66,0.6)');
  ctx.fillStyle = mainGrad;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 60, 0, Math.PI * 2);
  ctx.fill();

  // 滴落轨迹（向下）
  ctx.fillStyle = 'rgba(255,200,100,0.7)';
  for (let i = 0; i < 3; i++) {
    const y = centerY + 50 + i * 25;
    const x = centerX + (Math.random() - 0.5) * 15;
    const w = 8 + Math.random() * 6;
    const h = 20 + Math.random() * 10;
    ctx.fillRect(x - w/2, y, w, h);
  }

  // 飞溅小点
  ctx.fillStyle = 'rgba(255,180,80,0.6)';
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const dist = 40 + Math.random() * 30;
    const x = centerX + Math.cos(angle) * dist;
    const y = centerY + Math.sin(angle) * dist;
    const r = 2 + Math.random() * 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function spawnYolkStainOnPerson(hitWorldPos) {
  if (!person || !modelRoot) return;
  
  // 将世界坐标转换为模型局部坐标（相对于 modelRoot，不是 person）
  const localPos = modelRoot.worldToLocal(hitWorldPos.clone());
  
  // 创建蛋液 Sprite
  const stainTex = createYolkStainTexture();
  const stainMat = new THREE.SpriteMaterial({
    map: stainTex,
    transparent: true,
    opacity: 1.0,
    depthTest: true,  // 启用深度测试，让它正确跟随模型
    depthWrite: false,
  });
  const stainSprite = new THREE.Sprite(stainMat);
  
  // 附着在模型上（modelRoot），这样会跟随骨骼动画和受击动作
  stainSprite.position.copy(localPos);
  stainSprite.scale.set(0.4, 0.5, 1);
  stainSprite.renderOrder = 5;
  
  modelRoot.add(stainSprite);
  
  yolkStains.push({
    sprite: stainSprite,
    localPos: localPos.clone(),
    parent: modelRoot,  // 记录父对象，方便清理
    life: 8.0,  // 持续8秒
    maxLife: 8.0,
    dripSpeed: 0.15 + Math.random() * 0.1,  // 滴落速度
  });
}

function createEgg() {
  // 椭球形：用球体然后 scale
  const eggGeo = new THREE.SphereGeometry(0.12, 16, 16);
  eggGeo.scale(1, 1.35, 1); // Y 轴拉长成椭球

  const shellTex = createEggShellTexture();
  const eggMat = new THREE.MeshStandardMaterial({
    map: shellTex,
    roughness: 0.7,
    metalness: 0.0,
  });

  const egg = new THREE.Mesh(eggGeo, eggMat);
  egg.position.set((Math.random() - 0.5) * 1.2, 0.6, 3);

  // 随机瞄准人物的不同位置（头、胸、肚子等）
  const targetY = (() => {
    const r = Math.random();
    if (r < 0.35) return 1.9 + Math.random() * 0.3;      // 头部区域
    else if (r < 0.7) return 1.3 + Math.random() * 0.4;  // 胸部区域
    else return 0.8 + Math.random() * 0.4;                // 肚子区域
  })();
  const targetX = (Math.random() - 0.5) * 0.5;  // 左右随机偏移
  const targetZ = (Math.random() - 0.5) * 0.3;  // 前后随机偏移

  egg.userData = {
    t: 0,
    start: egg.position.clone(),
    end: new THREE.Vector3(targetX, targetY, targetZ),
    isBroken: false,
  };

  scene.add(egg);
  eggs.push(egg);

  playEggThrowSound();
}

document.getElementById('eggBtn').onclick = createEgg;

/* ================= 马桶 + 漩涡 ================= */
const toilet = new THREE.Group();
toilet.position.set(0, 0, -0.8);
scene.add(toilet);

/* 底座 */
const base = new THREE.Mesh(
  new THREE.CylinderGeometry(0.6, 0.8, 0.4, 24),
  new THREE.MeshStandardMaterial({ color: 0xffffff })
);
base.position.y = 0.2;
toilet.add(base);

/* 座圈 */
const seat = new THREE.Mesh(
  new THREE.TorusGeometry(0.45, 0.08, 16, 32),
  new THREE.MeshStandardMaterial({ color: 0xeeeeee })
);
seat.rotation.x = Math.PI / 2;
seat.position.y = 0.45;
toilet.add(seat);

/* 漩涡水面 */
const swirlCanvas = document.createElement('canvas');
swirlCanvas.width = swirlCanvas.height = 256;
const swirlCtx = swirlCanvas.getContext('2d');
const swirlTex = new THREE.CanvasTexture(swirlCanvas);

const water = new THREE.Mesh(
  new THREE.CircleGeometry(0.35, 32),
  new THREE.MeshStandardMaterial({ map: swirlTex, transparent: true })
);
water.rotation.x = -Math.PI / 2;
water.position.y = 0.46;
toilet.add(water);

// 漫画对话气泡
const bubbles = [];
function createBubble(text, pos){
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 14;
  // 圆角矩形
  const r = 56; const w = 420; const h = 240; const x = 46; const y = 60;
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 尖角
  ctx.beginPath();
  ctx.moveTo(180, y+h);
  ctx.lineTo(220, y+h+80);
  ctx.lineTo(260, y+h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // 文字
  ctx.fillStyle = '#000';
  ctx.font = 'bold 56px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  lines.forEach((l,i)=>ctx.fillText(l, size/2, y+80+i*64));
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.position.copy(pos);
  sp.scale.set(3.2, 2.8, 1);
  scene.add(sp);
  bubbles.push(sp);
  return sp;  // 返回 sprite 以便后续调整
}
// 背景气泡：根据移动端调整位置和大小
const bubbleScale = isMobile ? 2.0 : 3.2;
const bubbleY1 = isMobile ? 1.8 : 2.2;
const bubbleY2 = isMobile ? 1.6 : 2.0;
const bubbleX1 = isMobile ? 1.0 : 1.6;
const bubbleX2 = isMobile ? -1.0 : -1.6;

// 背景气泡放在人物后面（z 为负值，避免穿模）
const bubbleZ = -1.8;  // 人物后面
const bubble1 = createBubble('压力山大!\n受够了!', new THREE.Vector3(bubbleX1, bubbleY1, bubbleZ));
const bubble2 = createBubble('我要发泄!', new THREE.Vector3(bubbleX2, bubbleY2, bubbleZ + 0.1));
if (bubble1) bubble1.scale.setScalar(bubbleScale);
if (bubble2) bubble2.scale.setScalar(bubbleScale);

function updateSwirl(time, flushIntensity = 0) {
  swirlCtx.clearRect(0,0,256,256);
  swirlCtx.translate(128,128);
  
  // 冲走时旋转更快
  const baseSpeed = 0.002;
  const flushSpeed = baseSpeed * (1 + flushIntensity * 5);  // 旋转更快
  swirlCtx.rotate(time * flushSpeed);

  // 冲走时漩涡更明显、更亮、更大
  const centerAlpha = 0.9 + flushIntensity * 0.1;
  const edgeAlpha = 0.2 + flushIntensity * 0.5;
  const radius = 120 + flushIntensity * 30;  // 漩涡范围更大
  const g = swirlCtx.createRadialGradient(0,0,10,0,0,radius);
  g.addColorStop(0,`rgba(255,255,255,${centerAlpha})`);
  g.addColorStop(0.3,`rgba(180,220,255,${0.6 + flushIntensity * 0.4})`);
  g.addColorStop(0.6,`rgba(120,180,255,${0.5 + flushIntensity * 0.4})`);
  g.addColorStop(1,`rgba(100,150,255,${edgeAlpha})`);
  swirlCtx.fillStyle = g;
  swirlCtx.beginPath();
  swirlCtx.arc(0,0,radius,0,Math.PI*2);
  swirlCtx.fill();

  // 冲走时添加更多螺旋线条增强效果
  if (flushIntensity > 0) {
    swirlCtx.strokeStyle = `rgba(200,230,255,${flushIntensity * 0.8})`;
    swirlCtx.lineWidth = 4 + flushIntensity * 4;  // 线条更粗
    for (let i = 0; i < 5; i++) {  // 更多线条
      const angle = (time * flushSpeed * 1000 + i * Math.PI * 2 / 5) % (Math.PI * 2);
      swirlCtx.beginPath();
      swirlCtx.moveTo(0, 0);
      swirlCtx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      swirlCtx.stroke();
    }
    
    // 添加外圈波纹
    swirlCtx.strokeStyle = `rgba(150,200,255,${flushIntensity * 0.5})`;
    swirlCtx.lineWidth = 2;
    for (let r = 80; r <= radius; r += 15) {
      swirlCtx.beginPath();
      swirlCtx.arc(0, 0, r, 0, Math.PI * 2);
      swirlCtx.stroke();
    }
  }

  swirlCtx.setTransform(1,0,0,1,0,0);
  swirlTex.needsUpdate = true;
}

/* ================= 冲走 ================= */
/* ================= 冲走（修复 & 强化） ================= */
const flushBtn = document.getElementById('flushBtn');
let isFlushing = false;

// 冲走时的水流粒子效果
const flushParticles = [];
const flushSplashes = [];

flushBtn.onclick = () => {
  if (isFlushing) return;
  isFlushing = true;
  flushBtn.disabled = true;

  // 暂停跳舞动画（如果有）
  if (currentDanceAction) {
    currentDanceAction.fadeOut(0.1);
  }
  // 暂停程序化跳舞
  isDancing = false;

  playFlushSound();

  // 清理旧粒子
  flushParticles.forEach(p => {
    scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
  });
  flushParticles.length = 0;
  flushSplashes.forEach(s => {
    scene.remove(s.mesh);
    s.mesh.geometry.dispose();
    s.mesh.material.dispose();
  });
  flushSplashes.length = 0;

  const startPos = person.position.clone();
  const startScale = person.scale.clone();
  const startRot = person.rotation.clone();

  // 脚底位置（人物当前位置的正下方）
  const footPos = new THREE.Vector3(startPos.x, 0, startPos.z);
  const duration = 1500;  // 稍微延长总时长
  const rotatePhase = 0.4;  // 前40%时间原地旋转
  const suckPhase = 1 - rotatePhase;  // 后60%时间被吸走
  const startTime = performance.now();
  let lastParticleTime = 0;
  let lastFrameTime = startTime;

  function animateFlush(now) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.05);  // 限制最大 dt
    lastFrameTime = now;
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);

    // 判断当前阶段
    const isRotating = t < rotatePhase;  // 旋转阶段
    const isSucking = t >= rotatePhase;  // 吸走阶段
    
    // 旋转阶段的进度（0-1）
    const rotateProgress = isRotating ? t / rotatePhase : 1;
    // 吸走阶段的进度（0-1）
    const suckProgress = isSucking ? (t - rotatePhase) / suckPhase : 0;

    // 第一阶段：原地旋转
    if (isRotating) {
      // 保持位置不变
      person.position.copy(startPos);
      
      // 加速旋转（越转越快）
      const rotateSpeed = 0.3 + rotateProgress * 1.5;  // 从0.3加速到1.8
      person.rotation.y += rotateSpeed;
      person.rotation.z += rotateSpeed * 0.5;
      
      // 轻微缩小（旋转时开始缩小）
      const s = 1 - rotateProgress * 0.3;
      person.scale.setScalar(s);
      
      // 漩涡效果逐渐增强（在人物脚底）
      const swirlIntensity = rotateProgress * 0.6;
      updateSwirl(now, swirlIntensity);
      // 将漩涡移动到人物脚底位置
      const worldFootPos = footPos.clone();
      const localFootPos = toilet.worldToLocal(worldFootPos);
      water.position.copy(localFootPos);
      water.position.y = 0.01;  // 稍微高于地面
      water.scale.setScalar(0.5 + swirlIntensity * 0.8);
      water.rotation.z -= 0.3 + swirlIntensity * 0.5;
      
      // 生成少量粒子（旋转阶段）
      if (elapsed - lastParticleTime > 30) {
        lastParticleTime = elapsed;
        spawnFlushParticles(footPos, swirlIntensity * 0.5);
      }
    }
    // 第二阶段：被脚底吸走
    else {
      // 强缓动（快速被吸入）
      const ease = suckProgress * suckProgress * suckProgress;  // 三次方缓动，加速吸入
      
      // 从当前位置被吸到脚底
      person.position.lerpVectors(startPos, footPos, ease);
      
      // 继续旋转（但速度逐渐减慢）
      const rotateSpeed = 1.8 - suckProgress * 1.5;  // 从1.8减速到0.3
      person.rotation.y += rotateSpeed;
      person.rotation.z += rotateSpeed * 0.5;
      
      // 快速缩小
      const baseScale = 0.7;  // 旋转阶段结束时的缩放
      const s = Math.max(baseScale - ease * baseScale, 0.02);
      person.scale.setScalar(s);
      
      // 漩涡效果达到最大（跟随人物脚底）
      const swirlIntensity = 0.6 + suckProgress * 0.4;  // 从0.6到1.0
      updateSwirl(now, swirlIntensity);
      // 将漩涡移动到人物脚底位置（跟随人物）
      const currentFootPos = new THREE.Vector3(person.position.x, 0, person.position.z);
      const localFootPos = toilet.worldToLocal(currentFootPos);
      water.position.copy(localFootPos);
      water.position.y = 0.01;  // 稍微高于地面
      water.scale.setScalar(0.8 + swirlIntensity * 1.2);  // 逐渐放大
      water.rotation.z -= 0.6 + swirlIntensity * 0.4;
      
      // 生成大量粒子（吸走阶段）
      if (elapsed - lastParticleTime > 20) {
        lastParticleTime = elapsed;
        spawnFlushParticles(footPos, swirlIntensity);
      }
    }

    // 更新水流粒子（始终朝向脚底位置）
    updateFlushParticles(dt, footPos, isSucking ? (0.6 + suckProgress * 0.4) : rotateProgress * 0.6);

    if (t < 1) {
      requestAnimationFrame(animateFlush);
    } else {
      // 完全吸走后停留
      setTimeout(() => {
        resetAfterFlush();
      }, 500);
    }
  }

  requestAnimationFrame(animateFlush);
};

function spawnFlushParticles(targetPos, intensity) {
  // 从人物周围生成粒子，然后被吸向脚底
  const personPos = person.position.clone();
  const count = Math.floor(6 + intensity * 12);  // 强度越大粒子越多（增大）

  for (let i = 0; i < count; i++) {
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(0.06 + Math.random() * 0.04, 8, 8),  // 粒子更大
      new THREE.MeshStandardMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0.8,
        emissive: 0x44aaff,
        emissiveIntensity: 0.7,  // 更亮
      })
    );

    // 从人物周围生成粒子（围绕人物）
    const angle = (i / count) * Math.PI * 2;
    const radius = 0.3 + Math.random() * 0.2;  // 围绕人物的半径
    const height = Math.random() * 1.5;  // 从脚底到头顶的高度范围
    particle.position.set(
      personPos.x + Math.cos(angle) * radius,
      personPos.y + height,  // 从人物周围的高度生成
      personPos.z + Math.sin(angle) * radius
    );

    // 初始速度：轻微向外扩散，然后被吸向脚底
    const toFoot = targetPos.clone().sub(particle.position);
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 0.2,  // 轻微随机
      -0.3 - Math.random() * 0.3,   // 向下（被吸）
      (Math.random() - 0.5) * 0.2
    );

    scene.add(particle);
    flushParticles.push({
      mesh: particle,
      vel,
      life: 1.0 + Math.random() * 0.5,  // 生命周期更长
      maxLife: 1.0 + Math.random() * 0.5,
    });
  }
}

function updateFlushParticles(dt, targetPos = null, intensity = 0) {
  for (let i = flushParticles.length - 1; i >= 0; i--) {
    const p = flushParticles[i];
    p.life -= dt;

    // 如果有目标位置，粒子被吸入（吸入力更大）
    if (targetPos) {
      const toTarget = targetPos.clone().sub(p.mesh.position);
      const pullStrength = intensity * 4.0;  // 吸入力更大
      p.vel.addScaledVector(toTarget.normalize(), pullStrength * dt);
    }
    p.vel.multiplyScalar(0.92);  // 阻尼
    p.vel.y -= 2.0 * dt;  // 轻微重力

    p.mesh.position.addScaledVector(p.vel, dt);
    p.mesh.rotation.x += dt * 2;
    p.mesh.rotation.y += dt * 1.5;

    // 淡出
    p.mesh.material.opacity = Math.max(p.life / p.maxLife * 0.8, 0);
    p.mesh.scale.setScalar(0.8 + (p.life / p.maxLife) * 0.7);  // 初始更大

    if (p.life <= 0 || (targetPos && p.mesh.position.distanceTo(targetPos) < 0.2)) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      flushParticles.splice(i, 1);
    }
  }

  // 生成水花飞溅效果（在目标位置，仅在冲走时）
  if (targetPos && intensity > 0 && Math.random() < intensity * 0.6) {  // 生成频率更高
    const splash = new THREE.Mesh(
      new THREE.SphereGeometry(0.1 + Math.random() * 0.05, 8, 8),  // 水花更大
      new THREE.MeshStandardMaterial({
        color: 0xaaccff,
        transparent: true,
        opacity: 0.7,
        emissive: 0x66bbff,
        emissiveIntensity: 1.0,  // 更亮
      })
    );
    splash.position.copy(targetPos);
    splash.position.add(new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,  // 范围更大
      (Math.random() - 0.5) * 0.3,
      (Math.random() - 0.5) * 0.5
    ));

    const splashVel = new THREE.Vector3(
      (Math.random() - 0.5) * 2.5,  // 速度更大
      Math.random() * 1.2,
      (Math.random() - 0.5) * 2.5
    );

    const baseScale = 1.3 + Math.random() * 0.4;  // 初始更大
    splash.scale.setScalar(baseScale);
    splash.userData.baseScale = baseScale;  // 保存初始缩放
    scene.add(splash);
    flushSplashes.push({
      mesh: splash,
      vel: splashVel,
      life: 0.5 + Math.random() * 0.3,  // 生命周期更长
      maxLife: 0.5 + Math.random() * 0.3,
    });
  }

  // 更新水花
  for (let i = flushSplashes.length - 1; i >= 0; i--) {
    const s = flushSplashes[i];
    s.life -= dt;
    s.vel.y -= 9.8 * dt;  // 重力
    s.mesh.position.addScaledVector(s.vel, dt);
    s.mesh.material.opacity = Math.max(s.life / s.maxLife * 0.7, 0);
    // 从初始大小逐渐缩小
    const baseScale = s.mesh.userData.baseScale || 1.2;
    s.mesh.scale.setScalar(baseScale * (0.3 + (s.life / s.maxLife) * 0.7));

    if (s.life <= 0) {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
      flushSplashes.splice(i, 1);
    }
  }
}

function resetAfterFlush() {
  // 先让人物“消失”，再在 3 秒后重新出现
  person.visible = false;
  person.position.set(0, 0, 0);
  person.scale.set(1, 1, 1);
  person.rotation.set(0, 0, 0);
  
  // 重置漩涡位置到马桶
  water.position.set(0, 0.46, 0);  // 回到马桶的本地坐标
  water.scale.setScalar(1);
  water.rotation.z = 0;

  // 清理所有蛋液
  for (let i = yolkStains.length - 1; i >= 0; i--) {
    const stain = yolkStains[i];
    if (stain.parent) stain.parent.remove(stain.sprite);
    disposeSprite(stain.sprite);
    yolkStains.splice(i, 1);
  }

  // 清理所有水流粒子（延迟清理，让粒子自然消失）
  setTimeout(() => {
    flushParticles.forEach(p => {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    });
    flushParticles.length = 0;
    flushSplashes.forEach(s => {
      scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    });
    flushSplashes.length = 0;
  }, 500);

  // 重置水面
  water.scale.set(1, 1, 1);
  water.rotation.set(-Math.PI / 2, 0, 0);

  // 此时仍视为 flushing 中，按钮继续禁用
  spawnFlushSlogan();

  setTimeout(() => {
    person.visible = true;
    flushBtn.disabled = false;
    isFlushing = false;
    
    // 恢复跳舞动画（如果有）
    if (currentDanceAction) {
      currentDanceAction.reset().fadeIn(0.3).play();
    }
    // 恢复程序化跳舞
    isDancing = true;
  }, 3000);
}


/* ================= 工具函数 ================= */
function createClothTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  // 上半红色T恤
  const grdTop = ctx.createLinearGradient(0,0,0,140);
  grdTop.addColorStop(0,'#ff5a4f');
  grdTop.addColorStop(1,'#d63b2f');
  ctx.fillStyle = grdTop;
  ctx.fillRect(0,0,256,140);
  // 下半蓝色长裤
  const grdBottom = ctx.createLinearGradient(0,140,0,256);
  grdBottom.addColorStop(0,'#2f5fb3');
  grdBottom.addColorStop(1,'#254c8e');
  ctx.fillStyle = grdBottom;
  ctx.fillRect(0,140,256,116);
  // 腰线
  ctx.fillStyle = '#222';
  ctx.fillRect(0,138,256,4);
  // 裤子中缝
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(128,150);
  ctx.lineTo(128,250);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}

/* ================= 动画循环 ================= */
let shake = 0;
const clock = new THREE.Clock();

// 简单全局音频上下文
let globalAudioCtx = null;

function getAudioContext() {
  if (globalAudioCtx) return globalAudioCtx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  globalAudioCtx = new Ctx();
  return globalAudioCtx;
}

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const now = performance.now();

  updateSwirl(now);

  if (mixer) {
    mixer.update(dt);
    
    // 检查受击动画是否结束，如果结束则恢复跳舞
    if (currentHitAction && currentHitAction.paused === false) {
      const time = currentHitAction.time;
      const duration = currentHitAction.getClip().duration;
      if (time >= duration - 0.05) {  // 接近结束时
        currentHitAction.paused = true;
        currentHitAction = null;  // 清除受击动作
        // 恢复跳舞动画（如果有）
        if (currentDanceAction) {
          currentDanceAction.reset().fadeIn(0.2).play();
        }
        // 恢复程序化跳舞
        isDancing = true;
      }
    }
    
    // 如果有 mixer 但没有跳舞动画，使用程序化跳舞
    if (!currentDanceAction && danceRig && isDancing) {
      updateProceduralDance(dt);
    }
  } else {
    // 没有 mixer：使用程序化受击和跳舞
    if (hitRig && hitRig.ttl > 0) {
      updateProceduralHit(dt);
      // 受击进行中时暂停跳舞
      if (isDancing) isDancing = false;
    } else {
      // 受击结束后，恢复跳舞
      if (!isDancing && danceRig) {
        isDancing = true;
      }
      if (danceRig && isDancing) {
        updateProceduralDance(dt);
      }
    }
  }

  // 更新鸡蛋
  for (let i = eggs.length - 1; i >= 0; i--) {
    const egg = eggs[i];
    
    // 破碎后只更新旋转，不再移动
    if (egg.userData.isBroken) {
      egg.rotation.x += 0.2;
      egg.rotation.z += 0.2;
      
      // 破碎后停留 0.4 秒再移除
      if (performance.now() - egg.userData.brokenTime > 400) {
        scene.remove(egg);
        eggs.splice(i, 1);
      }
      continue;
    }
    
    egg.userData.t += dt * 1.2;
    const t = egg.userData.t;
    
    // 受击提前触发（t >= 0.85），避免穿模到模型内部
    if (t >= 0.85) {
      // 受击：生成蛋黄纹理并应用到鸡蛋
      egg.userData.isBroken = true;
      const yolkTex = createYolkTexture();
      egg.material.map = yolkTex;
      egg.material.needsUpdate = true;
      egg.userData.brokenTime = performance.now();
      
      // 停在受击位置（提前计算，避免穿模）
      const hitT = 0.85;
      const hitPos = egg.userData.start.clone().lerp(egg.userData.end, hitT);
      hitPos.y += Math.sin(Math.PI * hitT) * 1.5;
      egg.position.copy(hitPos);
      
      // 在人物身上生成蛋液贴图
      spawnYolkStainOnPerson(hitPos);
      
      shake = 0.3;
      if (mixer && hitClips.length) playRandomHitReaction();
      else triggerProceduralHit();
      spawnHitReplyBubble();
      continue;
    }
    
    // 正常飞行轨迹
    egg.position.lerpVectors(egg.userData.start, egg.userData.end, t);
    egg.position.y += Math.sin(Math.PI * t) * 1.5;
    egg.rotation.x += 0.2;
    egg.rotation.z += 0.2;
  }

  // 更新人物身上的蛋液效果（滴落 + 淡出）
  for (let i = yolkStains.length - 1; i >= 0; i--) {
    const stain = yolkStains[i];
    stain.life -= dt;
    
    // 滴落效果：向下移动
    stain.localPos.y -= dt * stain.dripSpeed;
    stain.sprite.position.copy(stain.localPos);
    
    // 淡出效果
    const fadeOut = clamp(stain.life / stain.maxLife, 0, 1);
    stain.sprite.material.opacity = fadeOut * 0.9;
    
    // 轻微缩放（模拟扩散）
    const scale = 0.4 + (1 - fadeOut) * 0.2;
    stain.sprite.scale.set(scale, scale * 1.25, 1);
    
    if (stain.life <= 0) {
      if (stain.parent) stain.parent.remove(stain.sprite);
      disposeSprite(stain.sprite);
      yolkStains.splice(i, 1);
    }
  }

  // 抖动
  if (shake > 0) {
    shake -= dt;
    person.rotation.y = Math.sin(Date.now() * 0.03) * 0.25;
  } else {
    person.rotation.y *= 0.9;
  }

  // 对话气泡轻微上下浮动
  const t = now * 0.001;
  bubbles.forEach((sp,i)=>{
    sp.position.y += Math.sin(t*2 + i) * 0.003;
  });

  updateVoiceEffects(dt);

  // 更新水流粒子（清理残留）
  if (flushParticles.length > 0 || flushSplashes.length > 0) {
    updateFlushParticles(dt);
  }

  renderer.render(scene, camera);
}

animate();

function playFlushSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();

  const duration = 1.4;
  const now = ctx.currentTime;

  // 白噪声 + 低通扫频，模拟水流
  const bufferSize = ctx.sampleRate * duration;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.7;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(900, now);
  filter.frequency.exponentialRampToValueAtTime(260, now + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.6, now + 0.1);
  gain.gain.linearRampToValueAtTime(0.0, now + duration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  noise.start(now);
  noise.stop(now + duration + 0.05);
}

function playEggThrowSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();

  const now = ctx.currentTime;
  const duration = 0.18;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(260, now);
  osc.frequency.exponentialRampToValueAtTime(120, now + duration);

  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.55, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function updateVoiceEffects(dt) {
  // 录音时，实时更新音量（RMS）
  if (isVoiceRecording && analyserNode && volumeData) {
    analyserNode.getByteTimeDomainData(volumeData);
    let sum = 0;
    for (let i = 0; i < volumeData.length; i++) {
      const v = (volumeData[i] - 128) / 128; // [-1,1]
      sum += v * v;
    }
    const rms = Math.sqrt(sum / volumeData.length); // 0~1 左右
    // 平滑一点，避免抖动
    currentLoudness = currentLoudness * 0.85 + rms * 0.15;
    peakLoudness = Math.max(peakLoudness, currentLoudness);
  }

  // 录音中的临时气泡跟随按钮位置
  if (isVoiceRecording && liveVoiceSprite && voiceBall) {
    liveVoiceSprite.position.copy(getVoiceBallWorldPoint(3.0));
  }

  // 飞行气泡：从语音球飞向脸部（曲线 + 缩放）
  for (let i = flyingTexts.length - 1; i >= 0; i--) {
    const f = flyingTexts[i];
    f.t += dt / Math.max(f.duration, 0.0001);
    const tt = Math.min(f.t, 1);

    const p = quadBezier(f.start, f.control, f.target, tt);
    f.sprite.position.copy(p);

    const s = lerp(0.25, 1.25, easeOutCubic(tt));
    f.sprite.scale.setScalar(s);

    if (tt >= 1) {
      // 砸脸：抖动 + 碎裂/淡出
      shake = Math.max(shake, 0.3);
      if (mixer && hitClips.length) playRandomHitReaction();
      else triggerProceduralHit();
      explodeText(f.sprite, f.target);
      flyingTexts.splice(i, 1);
      spawnHitReplyBubble();
    }
  }

  // 碎裂碎片：飞散 + 淡出
  for (let i = shards.length - 1; i >= 0; i--) {
    const sh = shards[i];
    sh.life -= dt;
    sh.sprite.position.addScaledVector(sh.vel, dt);
    sh.vel.multiplyScalar(0.92);
    sh.sprite.material.opacity = Math.max(sh.life / sh.maxLife, 0);
    sh.sprite.scale.multiplyScalar(0.98);
    if (sh.life <= 0) {
      scene.remove(sh.sprite);
      disposeSprite(sh.sprite);
      shards.splice(i, 1);
    }
  }

  // 受击回复气泡：升起 + 淡入/淡出
  for (let i = hitReplyBubbles.length - 1; i >= 0; i--) {
    const item = hitReplyBubbles[i];
    item.life -= dt;
    const t = clamp(1 - item.life / item.maxLife, 0, 1);
    const fadeIn = Math.min(t * 3, 1);
    const fadeOut = clamp(item.life / (item.maxLife * 0.6), 0, 1);
    const alpha = clamp(fadeIn * fadeOut, 0, 1);

    item.sprite.position.y += dt * 0.35;
    item.sprite.material.opacity = alpha;

    if (item.life <= 0) {
      scene.remove(item.sprite);
      disposeSprite(item.sprite);
      hitReplyBubbles.splice(i, 1);
    }
  }

  // 冲走后从天而降的大字口号
  for (let i = sloganDrops.length - 1; i >= 0; i--) {
    const item = sloganDrops[i];
    item.t += dt / Math.max(item.duration, 0.0001);
    const t2 = Math.min(item.t, 1);

    // 下落 + 轻微弹跳
    const fall = easeOutCubic(t2);
    const pos = item.start.clone().lerp(item.end, fall);
    if (t2 > 0.8) {
      const bounce = Math.sin((t2 - 0.8) / 0.2 * Math.PI) * 0.15;
      pos.y += bounce;
    }
    item.sprite.position.copy(pos);

    // 淡入然后缓慢淡出
    const fadeIn = clamp(t2 * 2.2, 0, 1);
    const fadeOut = clamp(1 - Math.max(t2 - 0.4, 0) / 0.6, 0, 1);
    item.sprite.material.opacity = fadeIn * fadeOut;

    // 轻微缩放 & 摆动，卡通感（使用保存的初始缩放）
    const baseScaleX = item.baseScaleX || 4.5;
    const baseScaleY = item.baseScaleY || 3.4;
    const pulse = 1 + Math.sin(t2 * Math.PI) * 0.06;
    item.sprite.scale.set(baseScaleX * pulse, baseScaleY * pulse, 1);
    item.sprite.rotation.z = Math.sin(t2 * 3.0) * 0.06;

    if (t2 >= 1) {
      scene.remove(item.sprite);
      disposeSprite(item.sprite);
      sloganDrops.splice(i, 1);
    }
  }
}

function explodeText(mainSprite, atWorld) {
  // 主气泡淡出并移除
  scene.remove(mainSprite);
  disposeSprite(mainSprite);

  // 用字符碎片做“碎裂”感
  const text = (mainSprite.userData?._bubble?.text || '').trim() || '喷!';
  const chars = Array.from(text).slice(0, 10);

  chars.forEach((ch, idx) => {
    const sp = createTextBubbleSprite(ch, { fontSize: 72, padding: 80, maxWidth: 260 });
    sp.position.copy(atWorld);
    sp.scale.setScalar(0.18);
    sp.material.opacity = 0.95;
    scene.add(sp);

    const angle = (idx / Math.max(chars.length, 1)) * Math.PI * 2;
    const vel = new THREE.Vector3(Math.cos(angle), 0.6 + Math.random() * 0.6, Math.sin(angle))
      .multiplyScalar(1.2 + Math.random() * 0.8);
    vel.x += (Math.random() - 0.5) * 0.4;
    vel.z += (Math.random() - 0.5) * 0.4;

    shards.push({
      sprite: sp,
      vel,
      life: 0.45,
      maxLife: 0.45,
    });
  });
}

function quadBezier(p0, p1, p2, t) {
  const a = p0.clone().lerp(p1, t);
  const b = p1.clone().lerp(p2, t);
  return a.lerp(b, t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function clamp(v, min, max) {
  return v < min ? min : (v > max ? max : v);
}
