<?php
/*
 * This file is part of xelson/flarum-ext-chat
 */

namespace Xelson\Chat;

use Flarum\User\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

class ChatRepository
{
    public function query(): Builder
    {
        return Chat::query();
    }

    /**
     * @param User   $actor
     * @param string|null $scope 'all' 仅对管理员有效：列出全部
     */
    public function queryVisible(User $actor, ?string $scope = null): Builder
    {
        // 管理员 scope=all：列出全部
        if ($actor->isAdmin() && $scope === 'all') {
            return $this->query();
        }

        $actorId = (int) $actor->id;

        // 成员可见（任意类型）：pivot 存在且未 removed
        $memberIds = DB::table('neonchat_chat_user')
            ->select('chat_id')
            ->where('user_id', $actorId)
            ->whereNull('removed_at');

        // 公共频道额外可见：
        // - never：无 pivot 记录
        // - left：pivot 存在但 removed_by = 自己
        // - member：已包含在上面的 memberIds
        // - kicked：pivot.removed_by != 自己 且 removed_at 非空 → 不可见（排除）
        $kickedIds = DB::table('neonchat_chat_user')
            ->select('chat_id')
            ->where('user_id', $actorId)
            ->whereNotNull('removed_at')
            ->where(function ($q) use ($actorId) {
                $q->whereNull('removed_by')->orWhere('removed_by', '!=', $actorId);
            });

        return $this->query()->where(function (Builder $q) use ($memberIds, $kickedIds) {
            // 1) 我是成员
            $q->whereIn('id', $memberIds);
        })->orWhere(function (Builder $q) use ($actorId, $kickedIds) {
            // 2) 公共频道：可发现但排除 kicked
            $q->where('type', 1)
              ->whereNotIn('id', $kickedIds);
        });
    }

    public function findOrFail(int $id, User $actor): Chat
    {
        // 管理员无条件直通
        if ($actor->isAdmin()) {
            return $this->query()->findOrFail($id);
        }

        return $this->queryVisible($actor)->findOrFail($id);
    }
}

