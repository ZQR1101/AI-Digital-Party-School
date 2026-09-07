<template>
  <router-view v-slot="{ Component }">
    <keep-alive include="HomePage,CatalogPage,TaskListPage">
      <component :is="Component" />
    </keep-alive>
  </router-view>
</template>

<script setup>
</script>

<style>
/* 这里样式按需保留，不要写页面文字 */
</style>
