<script setup>
import { useRoute } from 'vue-router'
const route = useRoute()
</script>

<template>
  <div>
    <div class="page-heading"><div><h3>{{ route.meta.title }}</h3><p>该模块将在 P1 阶段实现</p></div></div>
    <el-empty description="页面骨架已预留，下一步继续开发" />
  </div>
</template>
