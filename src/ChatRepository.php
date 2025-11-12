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
     *
     * @return Builder
     */
    public function query(): Builder
    {
        return Chat::query();
    }

    /**
     * Query for chats visible to the given actor
     *
     * - 公共频道（type=1）对所有人可见
     * - 私聊/群聊（type=0）仅参与者可见
     *
     * @param  User $actor
     * @return Builder
     */
    public function queryVisible(User $actor): Builder
    {
        $query = $this->query();

        // +++ 新增：管理员绕过所有规则 +++
        if ($actor->isAdmin()) {
            return $query;
        }

        $query->where(function (Builder $q) use ($actor) {
            // ORIGINAL ISSUE:
            //   旧代码使用 ->get()->toArray() 传给 whereIn('id', ...)，得到的是二维数组
            //   形如：[ ['chat_id'=>1], ['chat_id'=>2] ]，与 whereIn 期望的一维标量数组不匹配，
            //   导致可见性过滤条件失效。
            //
            // FIX:
            //   使用 pluck('chat_id')->all() 获取一维 ID 列表：[1,2,...]
            $chatIds = ChatUser::where('user_id', $actor->id)->pluck('chat_id')->all();

            $q->where('type', 1)
              ->orWhereIn('id', $chatIds);
        });

        return $query;
    }

    /**
     * Find a chat by ID (visible for actor)
     *
     * @param  int  $id
     * @param  User $actor
     * @return Chat
     *
     * @throws \Illuminate\Database\Eloquent\ModelNotFoundException
     */
    public function findOrFail(int $id, User $actor): Chat
    {
        return $this->queryVisible($actor)->findOrFail($id);
    }
}
