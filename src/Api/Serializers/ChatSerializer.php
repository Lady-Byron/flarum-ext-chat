<?php

namespace Xelson\Chat\Api\Serializers;

use Flarum\Api\Serializer\AbstractSerializer;
use Flarum\Api\Serializer\UserSerializer;
use Flarum\Settings\SettingsRepositoryInterface;
use Xelson\Chat\Chat;

class ChatSerializer extends AbstractSerializer
{
    protected $type = 'chats';

    protected $settings;

    public function __construct(SettingsRepositoryInterface $settings)
    {
        $this->settings = $settings;
    }

    protected function getDefaultAttributes($chat): array
    {
        $attributes = $chat->getAttributes();

        if ($chat->created_at) {
            $attributes['created_at'] = $this->formatDate($chat->created_at);
        }

        return $attributes;
    }

    protected function creator($chat)
    {
        return $this->hasOne($chat, UserSerializer::class);
    }

    protected function users($chat)
    {
        return $this->hasMany($chat, UserChatSerializer::class);
    }

    protected function messages($chat)
    {
        return $this->hasMany($chat, MessageSerializer::class);
    }

    /**
     * 仅对“成员或管理员”暴露首末条，未加入公共频道/非成员不返回关系
     */
    protected function last_message($chat)
    {
        if ($this->canSeeContent($chat)) {
            return $this->hasOne($chat, MessageSerializer::class);
        }
        return null;
    }

    protected function first_message($chat)
    {
        if ($this->canSeeContent($chat)) {
            return $this->hasOne($chat, MessageSerializer::class);
        }
        return null;
    }

    protected function canSeeContent(Chat $chat): bool
    {
        $actor = $this->actor;

        if ($actor && $actor->isAdmin()) {
            return true;
        }

        $pivot = $chat->getChatUser($actor);

        return $pivot && !$pivot->removed_at;
    }
}

