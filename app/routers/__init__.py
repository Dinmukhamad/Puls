"""Legacy router package.

New application wiring lives in app.api.router and app.modules.*.
Keep this package lightweight so importing one legacy router does not import
every large router module as a side effect.
"""
