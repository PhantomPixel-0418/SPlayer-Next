<script setup lang="ts">
import type { MusicCommentItem } from "@shared/types/comment";
import { formatDate } from "@/utils/time";
import IconLucideThumbsUp from "~icons/lucide/thumbs-up";

defineProps<{ item: MusicCommentItem }>();
const { t } = useI18n();
</script>

<template>
  <SCard size="small" radius="lg">
    <div class="flex gap-3">
      <SImg
        v-if="item.avatar"
        :src="item.avatar"
        class="h-9 w-9 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/10"
        alt=""
      />
      <div v-else class="h-9 w-9 shrink-0 rounded-full bg-on-surface/8" />
      <div class="min-w-0 flex-1">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="truncate text-sm font-medium">{{ item.userName }}</div>
            <div class="mt-0.5 flex gap-2 text-xs text-on-surface-variant">
              <span v-if="item.time">{{ formatDate(item.time) }}</span>
              <span v-if="item.location">
                {{ t("comments.location", { location: item.location }) }}
              </span>
            </div>
          </div>
          <div
            v-if="item.likedCount != null"
            class="flex shrink-0 items-center gap-1 text-xs tabular-nums text-on-surface-variant"
          >
            <IconLucideThumbsUp class="size-3.5" />
            <span>{{ item.likedCount }}</span>
          </div>
        </div>
        <p class="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
          {{ item.text }}
        </p>
        <div v-if="item.images?.length" class="mt-2 grid w-fit max-w-full grid-cols-3 gap-1.5">
          <SImg
            v-for="(image, index) in item.images"
            :key="image"
            :src="image"
            :alt="`${item.userName} ${index + 1}`"
            :class="[
              'aspect-square max-w-full rounded-lg ring-1 ring-black/10 dark:ring-white/10',
              item.images.length === 1 ? 'w-48' : 'w-24',
            ]"
          />
        </div>
        <div v-if="item.reply?.length" class="mt-2 rounded-md bg-on-surface/5 px-3 py-2">
          <div
            v-for="reply in item.reply"
            :key="reply.id"
            class="text-xs leading-5 text-on-surface-variant"
          >
            <span class="font-medium text-on-surface">{{ reply.userName }}：</span>
            {{ reply.text }}
          </div>
        </div>
      </div>
    </div>
  </SCard>
</template>
