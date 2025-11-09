<?php
/*
 * This file is part of xelson/flarum-ext-chat
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Xelson\Chat\Api\Controllers;

use Xelson\Chat\Api\Serializers\ChatUserSerializer;
use Xelson\Chat\ChatRepository;
use Tobscure\JsonApi\Document;
use Illuminate\Contracts\Bus\Dispatcher;
use Psr\Http\Message\ServerRequestInterface;
use Flarum\Api\Controller\AbstractListController;

class ListChatsController extends AbstractListController
{
    /**
     * @var ChatUserSerializer
     */
    public $serializer = ChatUserSerializer::class;

    /**
     * 默认包含关系
     */
    public $include = [
        'creator',
        'users',
        'last_message',
        'last_message.user',
        'first_message',
    ];

    protected Dispatcher $bus;
    protected ChatRepository $chats;

    public function __construct(Dispatcher $bus, ChatRepository $chats)
    {
        $this->bus   = $bus;
        $this->chats = $chats;
    }

    /**
     * 列表：我参与(未退出) + 全部频道(type=1)
     * 但对未加入的频道，去掉 last/first_message，避免泄露
     */
    protected function data(ServerRequestInterface $request, Document $document)
    {
        $actor   = $request->getAttribute('actor');
        $include = $this->extractInclude($request);

        // 需要 ChatRepository 内存在 queryDiscoverable($actor)
        $chats = $this->chats
            ->queryDiscoverable($actor)
            ->with($include)   // 先预加载，下面可能会清空
            ->orderBy('updated_at', 'desc')
            ->get();

        // 对“未加入的频道”隐藏消息预览关系
        foreach ($chats as $chat) {
            if ((int) $chat->type === 1) {
                $pivot = method_exists($chat, 'getChatUser') ? $chat->getChatUser($actor) : null;
                if (!$pivot || $pivot->removed_at) {
                    // 置空关系，序列化时不会输出 included 内容
                    $chat->setRelation('last_message', null);
                    $chat->setRelation('first_message', null);
                }
            }
        }

        return $chats;
    }
}
