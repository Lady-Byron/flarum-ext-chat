<?php
/*
 * This file is part of xelson/flarum-ext-chat
 */

namespace Xelson\Chat\Api\Serializers;

use Xelson\Chat\Chat;

class ChatUserSerializer extends ChatSerializer
{
    protected function getDefaultAttributes($chat): array
    {
        $attributes = $chat->getAttributes();

        if ($chat->created_at) {
            $attributes['created_at'] = $this->formatDate($chat->created_at);
        }

        $actor = $this->actor;
        $pivot = $chat->getChatUser($actor);

        $isMember = $pivot && !$pivot->removed_at;
        $attributes['is_member'] = (bool) $isMember;

        // 管理员可旁观
        $attributes['can_view'] = $isMember || ($actor && $actor->isAdmin());

        if ($isMember) {
            $attributes['role']       = $pivot->role;
            $attributes['joined_at']  = $this->formatDate($pivot->joined_at);
            $attributes['readed_at']  = $this->formatDate($pivot->readed_at);
            $attributes['removed_at'] = $this->formatDate($pivot->removed_at);
            $attributes['removed_by'] = $pivot->removed_by;
            $attributes['unreaded']   = $chat->unreadedCount($pivot);
        }

        // 非成员（公共频道 never/left）不暴露成员专属字段与未读计数
        return $attributes;
    }
}
