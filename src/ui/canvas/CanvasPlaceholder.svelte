<script lang="ts">
  let { message }: { message: string } = $props();
</script>

<div class="silk-canvas-placeholder" data-silk-canvas>
  <p>{message}</p>
</div>

<style>
  .silk-canvas-placeholder {
    display: grid;
    place-items: center;
    height: 100%;
  }
</style>
