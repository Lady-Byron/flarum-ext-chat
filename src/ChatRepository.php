<?php
/*
 * This file is part of xelson/flarum-ext-chat
 */

namespace Xelson\Chat;

use Flarum\User\User;
use Illuminate\Database\Eloquent\Builder;

class ChatRepository
{
    public function query(): Builder
    {
        return Chat::query();
    }

    /**
     * 列表：我参与(未退出) + 全部频道(type=1)
     */
    public function queryDiscoverable(User $actor): Builder
    {
        $memberIds = ChatUser::query()
            ->where('user_id', $actor->id)
            ->whereNull('removed_at')
            ->pluck('chat_id')
            ->all();

        return $this->query()->where(function (Builder $q) use ($memberIds) {
            if (!empty($memberIds)) {
                $q->whereIn('id', $memberIds);
            }
            // 频道可发现
            $q->orWhere('type', 1);
        });
    }

    /**
     * 可阅读/参与：仅我参与(未退出)
     */
    public function queryVisible(User $actor): Builder
    {
        $memberIds = ChatUser::query()
            ->where('user_id', $actor->id)
            ->whereNull('removed_at')
            ->pluck('chat_id')
            ->all();

        if (empty($memberIds)) {
            $memberIds = [-1];
        }

        return $this->query()->whereIn('id', $memberIds);
    }

    public function findOrFail(int $id, User $actor): Chat
    {
        return $this->queryVisible($actor)->findOrFail($id);
    }
}
