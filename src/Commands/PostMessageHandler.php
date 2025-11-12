<?php
/*
 * This file is part of xelson/flarum-ext-chat
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Xelson\Chat\Commands;

use Carbon\Carbon;
use Illuminate\Contracts\Events\Dispatcher;
use Xelson\Chat\ChatRepository;
use Xelson\Chat\Event\Message\Saved;
use Xelson\Chat\Message;
use Xelson\Chat\MessageValidator;
use Flarum\User\Exception\PermissionDeniedException;

class PostMessageHandler
{
    /**
     * @var MessageValidator
     */
    protected $validator;

    /**
     * @param MessageValidator      $validator
     * @param ChatRepository        $chats
     * @param Dispatcher            $events
     */
    public function __construct(
        MessageValidator $validator,
        ChatRepository $chats,
        Dispatcher $events
    ) {
        $this->validator = $validator;
        $this->chats = $chats;
        $this->events = $events;
    }

    /**
     * Handles the command execution.
     *
     * @param PostMessage $command
     * @return null|string
     */
    public function handle(PostMessage $command)
    {
        $actor = $command->actor;
        $attributes = $command->data['attributes'];
        $ip_address = $command->ip_address;

        $content = $attributes['message'];
        $chat_id = $attributes['chat_id'];

        $chat = $this->chats->findOrFail($chat_id, $actor);

        $actor->assertCan('xelson-chat.permissions.chat');

        // +++ 新增：核心“写”权限检查 +++
        // 必须在 getChatUser() 之前调用，防止自动加入
        if (!$chat->canAccessContent($actor)) {
            throw new PermissionDeniedException();
        }

        $message = Message::build(
            $content,
            $actor->id,
            Carbon::now(),
            $chat->id,
            $ip_address
        );

        $this->validator->assertValid($message->getDirty());

        $message->save();

        $chat->users()->updateExistingPivot($actor->id, ['readed_at' => Carbon::now()]);

        $this->events->dispatch(
            new Saved($message, $actor, $command->data, true)
        );

        return $message;
    }
}
