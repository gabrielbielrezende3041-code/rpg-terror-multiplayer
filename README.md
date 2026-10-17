# Nightshift RPG — Multiplayer de terror tático

Protótipo web funcional com salas multiplayer via Socket.IO, papel de Mestre, jogadores, turnos, energia, câmeras, portas interligadas e controles dos oito animatrônicos.

## Requisitos
- Node.js 18 ou superior
- npm

## Executar
1. Extraia o ZIP.
2. Abra um terminal dentro da pasta `rpg-terror-multiplayer`.
3. Execute `npm install`.
4. Execute `npm start`.
5. Abra `http://localhost:3000` no navegador.
6. Crie uma partida como Mestre e copie o código.
7. Em outra janela ou dispositivo na mesma rede, abra o endereço do servidor e entre com o código.

Para permitir acesso de outros dispositivos na mesma rede, execute o servidor no computador anfitrião e use o endereço IP local dele, por exemplo `http://192.168.0.10:3000`. Para jogar pela internet, hospede o servidor em um serviço que suporte Node.js e WebSockets.

## Controles incluídos
- Criar sala e entrar por código.
- Foto de perfil opcional.
- Mestre e até oito jogadores.
- Liberação sequencial de turnos.
- Movimento para salas adjacentes.
- Energia inicial 20/20.
- Abrir/trocar câmeras custa 1 energia e não consome o turno.
- Fechar porta custa 1 energia e consome o turno.
- Portas interligadas: fechar uma abre automaticamente a outra; nunca ficam ambas fechadas.
- Robin: +10% automático após turno de jogador e do Mestre, além de ajustes manuais do Mestre e habilidade do jogador −30%.
- Controles do Mestre para movimento dos animatrônicos, estado de Felix, D20 de Gege, acordo de Gege, Maomao e retorno de Geto.
- Histórico de eventos e salvamento de snapshots em `campaigns.json`.

## Limitações desta primeira versão
- A interface e o servidor estão implementados como uma primeira versão jogável, mas ainda é necessário testar em uma hospedagem real com múltiplos clientes.
- As campanhas estão mantidas em memória durante a execução; `campaigns.json` registra snapshots de estado, mas ainda não implementa restauração automática completa.
- O conteúdo visual usa cenários CSS originais integrados à página; não há ilustrações externas separadas.
- As mecânicas de MalO/Vaporeon e algumas condições de eventos ainda precisam de detalhamento do criador para reproduzir exatamente as versões desejadas.
- As transições de noite, vitória e ataques podem ser refinadas em iterações seguintes conforme as regras finais.

## Segurança
Este projeto é uma base de desenvolvimento. Antes de disponibilizar publicamente, implemente autenticação mais forte, limites de requisição, validação adicional de uploads, persistência transacional e testes automatizados de carga e regras.
