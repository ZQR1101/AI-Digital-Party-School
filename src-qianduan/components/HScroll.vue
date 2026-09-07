<template>
  <div class="carousel" @pointerenter="pause" @pointerleave="resume">
    <div
      ref="scroller"
      class="h-scroll hide-scroll"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @scroll.passive="onScroll"
    >
      <slot />
    </div>
    <div v-if="count > 1" class="dots">
      <button
        v-for="index in count"
        :key="index"
        :class="{ on: index - 1 === active }"
        type="button"
        :aria-label="`第 ${index} 项`"
        @click="go(index - 1, true)"
      />
    </div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref } from 'vue'

const emit = defineEmits(['dragging'])
const scroller = ref(null)
const dragging = ref(false)
const active = ref(0)
const count = ref(0)
let pointerId = null
let startX = 0
let startLeft = 0
let moved = 0
let lastX = 0
let lastAt = 0
let velocity = 0
let timer = 0
let paused = false

function cards() {
  return [...(scroller.value?.children || [])].filter((node) => node.nodeType === 1)
}

function refreshCount() {
  count.value = cards().length
  markActive()
}

function markActive() {
  const el = scroller.value
  if (!el) return
  const items = cards()
  if (!items.length) return
  const mid = el.scrollLeft + el.clientWidth / 2
  let best = 0
  let dist = Infinity
  items.forEach((item, index) => {
    const center = item.offsetLeft + item.offsetWidth / 2
    const gap = Math.abs(center - mid)
    if (gap < dist) {
      dist = gap
      best = index
    }
    const ratio = Math.max(0, 1 - gap / (el.clientWidth * 0.9))
    item.style.setProperty('--card-scale', String(0.9 + ratio * 0.1))
    item.style.setProperty('--card-opacity', String(0.55 + ratio * 0.45))
    item.classList.toggle('is-active', index === best)
  })
  active.value = best
}

function go(index, user = false) {
  const el = scroller.value
  const items = cards()
  if (!el || !items.length) return
  const next = (index + items.length) % items.length
  items[next].scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  active.value = next
  if (user) restart()
}

function onScroll() {
  markActive()
}

function onDown(event) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  const el = scroller.value
  if (!el) return
  dragging.value = true
  paused = true
  moved = 0
  velocity = 0
  pointerId = event.pointerId
  startX = lastX = event.clientX
  lastAt = Date.now()
  startLeft = el.scrollLeft
  el.setPointerCapture(event.pointerId)
}

function onMove(event) {
  if (!dragging.value || event.pointerId !== pointerId) return
  const el = scroller.value
  if (!el) return
  const dx = event.clientX - startX
  moved = Math.max(moved, Math.abs(dx))
  const now = Date.now()
  const dt = Math.max(1, now - lastAt)
  velocity = (event.clientX - lastX) / dt
  lastX = event.clientX
  lastAt = now
  if (moved > 6) {
    emit('dragging', true)
    event.preventDefault()
  }
  el.scrollLeft = startLeft - dx
}

function snap() {
  const el = scroller.value
  const items = cards()
  if (!el || !items.length) return
  const projected = el.scrollLeft - velocity * 220
  let best = 0
  let dist = Infinity
  items.forEach((item, index) => {
    const gap = Math.abs(item.offsetLeft - projected)
    if (gap < dist) {
      dist = gap
      best = index
    }
  })
  go(best)
}

function onUp(event) {
  if (!dragging.value || event.pointerId !== pointerId) return
  const el = scroller.value
  dragging.value = false
  pointerId = null
  if (el && el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId)
  if (moved > 8) snap()
  window.setTimeout(() => emit('dragging', false), 0)
  paused = false
  restart()
}

function tick() {
  if (paused || dragging.value || count.value < 2) return
  go(active.value + 1)
}

function restart() {
  window.clearInterval(timer)
  timer = window.setInterval(tick, 3800)
}

function pause() { paused = true }
function resume() {
  paused = false
  restart()
}

onMounted(async () => {
  await nextTick()
  refreshCount()
  restart()
})
onUpdated(refreshCount)
onBeforeUnmount(() => window.clearInterval(timer))
</script>

<style scoped>
.carousel {
  width: 100%;
  min-width: 0;
}
.h-scroll {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  overflow-y: hidden;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 8px 2px 10px;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  touch-action: pan-x;
  overscroll-behavior-x: contain;
  -webkit-overflow-scrolling: touch;
  cursor: grab;
}
.h-scroll:active { cursor: grabbing; }
.h-scroll > :deep(*) {
  scroll-snap-align: start;
  scroll-snap-stop: always;
  flex: 0 0 82%;
  width: 82%;
  transform: scale(var(--card-scale, 0.94));
  opacity: var(--card-opacity, 0.7);
  transform-origin: center center;
  transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.45s ease;
}
.dots {
  display: flex;
  justify-content: center;
  gap: 7px;
  margin-top: 4px;
}
.dots button {
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: rgba(145, 0, 24, 0.18);
  transition: width 0.35s ease, background 0.35s ease;
}
.dots button.on {
  width: 18px;
  background: var(--primary-container);
}
</style>
