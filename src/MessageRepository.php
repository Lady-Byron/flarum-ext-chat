<?php
/*
 * This file is part of xelson/flarum-ext-chat
 */

namespace Xelson\Chat;

use Carbon\Carbon;
use Flarum\User\User;
use Illuminate\Database\Eloquent\Builder;
use Flarum\Settings\SettingsRepositoryInterface;
use Flarum\User\Exception\PermissionDeniedException;

class MessageRepository
{
    public $messages_per_fetch = 20;

    public function query(): Builder
    {
        return Message::query();
    }

    public function findOrFail($id)
    {
        return $this->query()->findOrFail($id);
    }

    /**
     * 仅允许：有效成员 或 管理员
     */
    public function queryVisible(Chat $chat, User $actor): Builder
    {
        $settings = resolve(SettingsRepositoryInterface::class);

        // 管理员：放行读取（只读）
        if ($actor->isAdmin()) {
            return $this->query()->where('chat_id', $chat->id);
        }

        $chatUser = $chat->getChatUser($actor);

        if (!$chatUser || $chatUser->removed_at) {
            // 统一抛 403，外层捕获为无权限
            throw new PermissionDeniedException();
        }

        // 成员可读；额外隐藏被他人删除的消息
        return $this->query()
            ->where('chat_id', $chat->id)
            ->where(function ($q) use ($actor) {
                $q->whereNull('deleted_by')
                  ->orWhere('deleted_by', $actor->id);
            });
    }

    /**
     * 拉取一个时间点上下的窗口
     */
    public function fetch($time, User $actor, Chat $chat)
    {
        // 若非成员/已退出，将在 queryVisible 内直接抛 403
        $top = $this->queryVisible($chat, $actor)->where('chat_id', $chat->id);
        $bottom = $this->queryVisible($chat, $actor)->where('chat_id', $chat->id);

        $chatUser = $chat->getChatUser($actor);

        if ($chatUser && $chatUser->removed_at) {
            // 理论上不会触发（上面已拒绝），为稳妥保留
            $top->where('created_at', '<=', $chatUser->removed_at);
            $bottom->where('created_at', '<=', $chatUser->removed_at);
        }

        $top->where('created_at', '>=', new Carbon($time))
            ->limit($this->messages_per_fetch + 1);

        $bottom->where('created_at', '<', new Carbon($time))
            ->orderBy('id', 'desc')
            ->limit($this->messages_per_fetch);

        $messages = $top->union($bottom);

        return $messages->get();
    }
}
