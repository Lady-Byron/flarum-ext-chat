<?php
/*
 * This file is part of xelson/flarum-ext-chat
 */

namespace Xelson\Chat;

use Flarum\User\User;
use Flarum\Database\AbstractModel;

class Chat extends AbstractModel
{
    protected $table = 'neonchat_chats';

    protected $dates = ['created_at'];

    public static function build($title, $color, $icon, $type, $creator_id = null, $created_at = null)
    {
        $chat = new static;

        $chat->title = $title;
        $chat->color = $color;
        $chat->icon = $icon;
        $chat->type = $type;
        $chat->creator_id = $creator_id;
        $chat->created_at = $created_at;

        return $chat;
    }

    public function unreadedCount($chatUser)
    {
        $start = $chatUser->readed_at ?: 0;

        $query = $this->messages()->where('created_at', '>', $start);
        if ($chatUser->removed_at) {
            $query->where('created_at', '<=', $chatUser->removed_at);
        }

        return $query->count();
    }

    /**
     * 仅查询 pivot，不做任何自动加入。
     */
    public function getChatUser(User $user): ?ChatUser
    {
        if (!$user || !$user->id) {
            return null;
        }

        return ChatUser::where('chat_id', $this->id)
            ->where('user_id', $user->id)
            ->first();
    }

    public function creator()
    {
        return $this->belongsTo(User::class, 'creator_id');
    }

    public function users()
    {
        return $this->belongsToMany(User::class, 'neonchat_chat_user')
            ->withPivot('joined_at', 'removed_by', 'role', 'readed_at', 'removed_at');
    }

    public function messages()
    {
        return $this->hasMany(Message::class);
    }

    public function last_message()
    {
        return $this->hasOne(Message::class)
            ->orderBy('id', 'desc')
            ->whereNull('deleted_by');
    }

    public function first_message()
    {
        return $this->hasOne(Message::class)
            ->orderBy('id', 'asc')
            ->whereNull('deleted_by');
    }
}

