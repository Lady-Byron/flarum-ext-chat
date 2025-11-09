<?php
/*
 * This file is part of xelson/flarum-ext-chat
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Xelson\Chat;

use Carbon\Carbon;
use Flarum\User\User;
use Illuminate\Database\Eloquent\Builder;
use Flarum\Settings\SettingsRepositoryInterface;

class MessageRepository
{
    public $messages_per_fetch = 20;

    /**
     * Get a new query builder for the posts table.
     */
    public function query(): Builder
    {
        return Message::query();
    }

    /**
     * Find a message by ID
     */
    public function findOrFail($id)
    {
        return $this->query()->findOrFail($id);
    }

    /**
     * Query for visible messages
     *
     * - 必须是成员且未退出，否则返回空查询
     * - 成员且 role=0（普通）时，只可见：未被任何人隐藏的消息 或 自己隐藏的消息
     */
    public function queryVisible(Chat $chat, User $actor): Builder
    {
        /** @var SettingsRepositoryInterface $settings */
        $settings = resolve(SettingsRepositoryInterface::class);

        $query    = $this->query();
        $chatUser = $chat->getChatUser($actor);

        // 非成员或已退出：不可见
        if (!$chatUser || $chatUser->removed_at) {
            return $query->whereRaw('1 = 0');
        }

        // 普通成员：隐藏他人隐藏的消息
        if ((int) ($chatUser->role ?? 0) === 0) {
            $query->where(function (Builder $q) use ($actor) {
                $q->whereNull('deleted_by')
                  ->orWhere('deleted_by', $actor->id);
            });
        }

        return $query;
    }

    /**
     * Fetching visible messages by time
     */
    public function fetch($time, User $actor, Chat $chat)
    {
        $chatUser = $chat->getChatUser($actor);

        $top = $this->queryVisible($chat, $actor)->where('chat_id', $chat->id);
        if ($chatUser && $chatUser->removed_at) {
            $top->where('created_at', '<=', $chatUser->removed_at);
        }
        $top->where('created_at', '>=', new Carbon($time))->limit($this->messages_per_fetch + 1);

        $bottom = $this->queryVisible($chat, $actor)->where('chat_id', $chat->id);
        if ($chatUser && $chatUser->removed_at) {
            $bottom->where('created_at', '<=', $chatUser->removed_at);
        }
        $bottom->where('created_at', '<', new Carbon($time))->orderBy('id', 'desc')->limit($this->messages_per_fetch);

        $messages = $top->union($bottom);

        return $messages->get();
    }
}
