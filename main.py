#!/usr/bin/env python
#
# Copyright 2007 Google Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
import os
import dex
import game_ajax
import lobby_ajax
from google.appengine.api import users
from google.appengine.ext import webapp
from google.appengine.ext.webapp import util, template


class ForceWikiPage(webapp.RequestHandler):
    '''Base class that pushes people to the tutorial before loggin in
    to the game world.'''
    def get(self):
        ''' Handler for get - redirects to the Tutorial page if not
        logged in. Otherwise calls our sublcass to generate the
        response.'''
        user = users.GetCurrentUser()
        if user:
            response = self.Get(user)
            if response:
                self.response.out.write(response)
        else:
            self.redirect(users.CreateLoginURL(self.request.uri))


class MainHandler(ForceWikiPage):
    template_path = os.path.join(os.path.dirname(__file__), 'main.html')
    def Get(self, user):
        template_values = {
            'user' : user,
            'logout_url' : users.CreateLogoutURL("/"),
            'maincontentClass' : 'mainContent'
        }
        return template.render(MainHandler.template_path, template_values)

class HistoryPage(ForceWikiPage):
    ''' Renderer for the history page '''
    template_path = os.path.join(os.path.dirname(__file__), 'history.html')
    def Get(self, user):
        completed_games = gamemodel.completed_games_list(user)

        wins = losses = draws = 0

        for game in completed_games:
            if game.is_victory(user):
                wins += 1
            elif game.is_loss(user):
                loss += 1
            else:
                draws += 1

        record_str = (pluralize(wins, "win, ", "wins, ") +
                      pluralize(losses, "loss, ", "losses, ") +
                      pluralize(draws, "draw, ", "draws, "))

        template_values = {
            'user' : user,
            'completed_games_list' : completed_games,
            'record_string' : record_str,
            'logout_url' : users.CreateLogoutURL('/'),
            'mainContentClass' : 'historyContent'
        }
        return template.render(HistoryPage.template_path, template_values)

def pluralize(count, singular, plural):
    phrase = singular if count == 1 else plural
    return "%d %s" % (count, phrase)

class LobbyPage(ForceWikiPage):
    ''' Renderer for a page that shows the game lobby '''
    template_path = os.path.join(os.path.dirname(__file__), 'lobby.html')
    def Get(self, user):
        template_values = {
            'user' : user,
            'logout' : users.CreateLogoutURL('/'),
            'mainContentClass' : 'lobbyContent'
        }
        return template.render(LobbyPage.template_path, template_values)

class GamePage(ForceWikiPage):
    ''' Renderer for a page that shows an individual game '''
    template_path = os.path.join(os.path.dirname(__file__), 'game.html')
    def Get(self, user):
        template_values = {
            'user' : user,
            'logout_url' : users.CreateLogoutURL('/'),
            'game_key' : self.request.path.strip('/').split('/')[-1],
            'mainContentClass' : 'mainContent'
        }
        return template.render(GamePage.template_path, template_values)

class BattlePage(ForceWikiPage):
    ''' Renderer for a page that shows an individual battle '''
    template_path = os.path.join(os.path.dirname(__file__), 'battle.html')
    def Get(self, user):
        template_values = {
            'user' : user,
            'logout_url' : users.CreateLogoutURL('/'),
            'game_key' : self.request.path.strip('/').split('/')[-1],
            'mainContentClass' : 'mainContent'
        }
        return template.render(BattlePage.template_path, template_values)

def main():
    application = webapp.WSGIApplication(
        [('/', MainHandler),
         ('/lobby', LobbyPage),
         ('/history', HistoryPage),
         ('/game/.*', GamePage),
         ('/battle/.*', BattlePage),
         ('/lobby_ajax.*', lobby_ajax.LobbyHandler),
         ('/game_ajax.*', game_ajax.GameHandler),
         ('/dex_ajax.*', dex.DexHandler)],
         debug=True)
    util.run_wsgi_app(application)



if __name__ == '__main__':
    main()
