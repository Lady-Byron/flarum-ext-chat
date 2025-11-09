<?php
/*
 * This file is part of xelson/flarum-ext-chat
 */

namespace Xelson\Chat;

use Flarum\User\User;
use Illuminate\Database\Eloquent\Builder;

class ChatRepository
{
    /**
     * Get a new query builder for the chats table
     */
    public function query(): Builder
    {
        return Chat::query();
    }

    /**
     * Only chats visible to the given actor:
     * - 必须是成员，且未被移除（removed_at IS NULL）
     * - 不再把 type=1 的频道对所有人公开
     */
    public function queryVisible(User $actor): Builder
    {
        // 仅拿到“我参与且未退出”的 chat_id 列表
        $chatIds = ChatUser::query()
            ->where('user_id', $actor->id)
            ->whereNull('removed_at')
            ->pluck('chat_id')
            ->all();

        // 若为空，用一个不可能命中的值，确保无结果
        if (empty($chatIds)) {
            $chatIds = [-1];
        }

        return $this->query()->whereIn('id', $chatIds);
    }

    /**
     * Find a chat by ID (visible for actor)
     */
    public function findOrFail(int $id, User $actor): Chat
    {
        return $this->queryVisible($actor)->findOrFail($id);
    }
}

